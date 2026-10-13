"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { panClasses, useSpacePan } from "@/components/use-space-pan";
import { buildGraph, peopleList, proposalEdges, provHelp, provLabel, type Detail, type GNode, type Graph, type PersonId, type PersonInfo, type Scope } from "@/components/landing-demo-graph";
import { PersonPicker, StatusChip } from "@/components/landing-demo-people";
import { Avatar } from "@/components/landing-demo-table";

// The Workflow tab of the landing-page demo. The payroll run is drawn as cards joined by wires, from the documents and data
// it starts from to the audit record. Two scopes (the whole company, or one person) and three levels of detail
// (simplified, complex, detailed). Every card says where its data is stored and which document it came from, so an approver
// can follow any number back to its source. AI only reads what the company provides; code does the arithmetic.
// Click a card for its details, drag a card to move it, hold Space and drag to pan, and ask the (scripted) AI for an
// improvement. Nothing here is sent anywhere.
// Moving a card writes straight to the DOM (transform and the wires touching it) so dragging stays smooth; React state only
// changes when the drag ends.

type Pt = { x: number; y: number };
export type WorkflowStart = { scope: Scope; who: PersonId; detail: Detail; sel: string | null };

const W = 184;
const H = 124;
const GX = 48;
const GY = 16;
const PAD = 24;
const MIN_SCALE = 0.8;

const homeOf = (n: GNode): Pt => ({ x: PAD + n.col * (W + GX), y: PAD + n.row * (H + GY) });
const wirePath = (a: Pt, b: Pt) => {
  // Cards stacked in one column join bottom to top; everything else runs left to right.
  if (b.x < a.x + W + 30) {
    const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y, dy = Math.max(30, Math.abs(y2 - y1) / 2);
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
  const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, dx = Math.max(40, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type Proposal = { title: string; stat: string; text: string; detail: string; effect: string };
const scripts: { re: RegExp; p: Proposal }[] = [
  { re: /wallet|noah|recipient|confirm/i, p: { title: "Wallet change confirmation", stat: "2nd person", text: "A second person confirms a new wallet", detail: "Hold any payment to a wallet that changed in the last 30 days until a second person confirms the new recipient in a call-back check.", effect: "Noah Kim's $7,800.00 stays on hold until the new wallet is confirmed. The other 12 payments go out as planned." } },
  { re: /kenji|140|cap|hours|overtime|fix/i, p: { title: "Hours cap check", stat: "Cap at 140 h", text: "Hours over the contract cap go to a manager", detail: "Pay the first 140 hours of Kenji Watanabe automatically. Send the other 2 hours to his manager for approval before they are paid.", effect: "Kenji's pay in this run changes from $6,390.00 to $6,300.00 until the manager approves the 2 extra hours ($90.00)." } },
  { re: /./, p: { title: "Second review step", stat: "Extra check", text: "A second person checks runs over $75,000", detail: "Add a review step before payment. Any run above $75,000 needs a second approver who did not prepare it.", effect: "This run totals $79,102.00, so it would need one more signature. No payment amounts change." } },
];
const fixPrompt = "Kenji Watanabe's 142 hours are over his 140 hour cap. Suggest a fix.";
const promptFor = (p: PersonInfo | undefined) => (p && p.status === "hold" ? `${p.name}'s payout wallet changed on Oct 6. Suggest a fix.` : p && p.status === "review" ? fixPrompt : fixPrompt);

const phone = "(max-width: 767px)";
/** True on a phone-width screen; the details and the AI box then open as overlays instead of side panels. */
function useIsPhone() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(phone); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(phone).matches,
    () => false,
  );
}

const stepProposal = (title: string): Proposal => ({
  title: `Extra check on ${title}`, stat: "Extra check", text: `A second look at ${title}`,
  detail: `Add a check after "${title}" that compares its result with last month and sends differences above 5% to a person before the next step runs.`,
  effect: "No amounts change. A run with a difference above 5% waits for a person; everything else flows through as before.",
});

const btn = "inline-flex h-8 cursor-pointer items-center rounded-[0.375rem] border border-foreground/20 bg-white px-3 text-[0.8125rem] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const seg = "h-8 cursor-pointer px-3 text-[0.8125rem] font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40";
const detailLabels: Record<Detail, string> = { simple: "Simplified", complex: "Complex", detailed: "Detailed" };
const provDot: Record<string, string> = { document: "bg-orbit", import: "bg-white", record: "bg-white/60", code: "bg-signal", approval: "bg-orbit" };

export function DemoWorkflow({ monthIdx, start }: { monthIdx: number; start?: WorkflowStart }) {
  const [scope, setScope] = useState<Scope>(start?.scope ?? "company");
  const [who, setWho] = useState<PersonId>(start?.who ?? "W008");
  const [detail, setDetail] = useState<Detail>(start?.detail ?? "complex");
  const [sel, setSel] = useState<string | null>(start?.sel ?? null);
  const [pos, setPos] = useState<Record<string, Pt>>({});
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiOut, setAiOut] = useState<React.ReactNode>(null);
  const [menu, setMenu] = useState(false);
  const [boxW, setBoxW] = useState(1070);
  const [mview, setMview] = useState<"graph" | "list">("graph");
  const isPhone = useIsPhone();

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const pathEls = useRef(new Map<string, SVGPathElement>());
  const live = useRef<Record<string, Pt>>({});
  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; pid: number } | null>(null);
  const frame = useRef(0);
  const justDragged = useRef(false);

  const clearSel = useCallback(() => setSel(null), []);
  const layer = (el: React.ReactElement) => (isPhone ? createPortal(el, document.body) : el);
  useSpacePan(canvasRef, { backgroundPan: true, onBackgroundTap: clearSel });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!(isPhone && (sel || aiOpen))) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isPhone, sel, aiOpen]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  /* ---- the graph for the chosen scope and level of detail ---- */
  const base = useMemo(() => buildGraph(scope, detail, who, monthIdx), [scope, detail, who, monthIdx]);
  const graph = useMemo<Graph>(() => {
    if (!proposal) return base;
    const [a, b] = proposalEdges(base);
    const from = base.nodes.find((n) => n.id === a[0]);
    const prop: GNode = {
      id: "prop", col: (from?.col ?? 0) + 0.5, row: Math.max(...base.nodes.map((n) => n.row)) + 0.9, group: "AI proposal", title: proposal.title, tag: "Proposed", stat: proposal.stat, text: proposal.text, tone: "prop",
      prov: "code", store: "Not saved (a proposal)", from: "Your prompt and the documents already in this workflow", info: { sub: "AI proposal · not applied", lines: [proposal.detail], note: proposal.effect },
    };
    return { nodes: [...base.nodes, prop], edges: [...base.edges, a, b] };
  }, [base, proposal]);

  const list = useMemo(() => peopleList(monthIdx), [monthIdx]);
  const person = list.find((x) => x.id === who);
  const attention = list.filter((x) => x.status !== "matched");
  const key = `${scope}:${detail}:${scope === "person" ? who : "all"}`;
  const at = (n: GNode): Pt => pos[`${key}:${n.id}`] ?? homeOf(n);
  const ptOf = (id: string): Pt => {
    const n = graph.nodes.find((x) => x.id === id)!;
    return live.current[`${key}:${id}`] ?? pos[`${key}:${id}`] ?? homeOf(n);
  };
  const board = useMemo(() => {
    const homes = graph.nodes.map(homeOf);
    return { w: Math.max(...homes.map((p) => p.x)) + W + PAD, h: Math.max(...homes.map((p) => p.y)) + H + PAD };
  }, [graph]);
  const scale = clamp((boxW - 2) / board.w, MIN_SCALE, 1);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const selNode = sel ? byId.get(sel) ?? null : null;

  const hot = useMemo(() => {
    if (!selNode) return null;
    const s = new Set<string>([selNode.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [a, b] of graph.edges) if (s.has(b) && !s.has(a)) { s.add(a); grew = true; }
    }
    return s;
  }, [selNode, graph]);

  /* ---- dragging: DOM writes only, state at the end ---- */
  const place = (id: string) => {
    const p = ptOf(id);
    const el = nodeEls.current.get(id);
    if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    for (const [a, b] of graph.edges) {
      if (a !== id && b !== id) continue;
      pathEls.current.get(`${a}>${b}`)?.setAttribute("d", wirePath(ptOf(a), ptOf(b)));
    }
  };
  const down = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || canvasRef.current?.dataset.space === "true") return;
    const p = ptOf(id);
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, pid: e.pointerId };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 5) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.dataset.dragging = "true";
    }
    e.stopPropagation();
    live.current[`${key}:${d.id}`] = { x: clamp(d.ox + dx, 0, board.w - W), y: clamp(d.oy + dy, 0, board.h - H) };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => place(d.id));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    delete e.currentTarget.dataset.dragging;
    if (!d.moved) return;
    cancelAnimationFrame(frame.current);
    place(d.id);
    const p = ptOf(d.id);
    setPos((cur) => ({ ...cur, [`${key}:${d.id}`]: p }));
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
  };
  const keyDown = (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === "Enter") { e.preventDefault(); setSel(id); return; }
    const step = 12;
    const delta = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : e.key === "ArrowDown" ? [0, step] : null;
    if (!delta) return;
    e.preventDefault();
    const p = ptOf(id);
    const next = { x: clamp(p.x + delta[0], 0, board.w - W), y: clamp(p.y + delta[1], 0, board.h - H) };
    live.current[`${key}:${id}`] = next;
    setPos((cur) => ({ ...cur, [`${key}:${id}`]: next }));
  };
  const moved = Object.keys(pos).some((k) => k.startsWith(`${key}:`));
  const reset = () => {
    live.current = {};
    setPos((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !k.startsWith(`${key}:`))));
  };

  /* ---- AI box (scripted) ---- */
  const join = <a href="#join" className="font-medium text-signal underline underline-offset-2">Join the waitlist</a>;
  const runAi = (kind: "submit" | "test") => {
    setMenu(false);
    const text = aiText.trim();
    if (!text) { setAiOut(<>Tell the AI what to change, or open a flagged step and click <b className="font-medium">Ask AI to fix this</b>.</>); return; }
    if (kind === "submit") { setAiOut(<><b className="font-medium">Submitting is part of the full product.</b> You need to join the waitlist to submit changes and test them on your own payroll. {join}</>); return; }
    const step = /^improve "([^"]+)"/i.exec(text);
    const p = step ? stepProposal(step[1]) : (scripts.find((s) => s.re.test(text)) ?? scripts[1]).p;
    setProposal(p);
    setSel("prop");
    setAiOut(<><b className="font-medium">Test result (scripted demo):</b> {p.detail} It is shown as a dashed card on the graph and is not applied. To test changes on your own payroll, subscribe: {join}.</>);
  };
  const askFix = () => { setAiText(scope === "person" ? promptFor(person) : fixPrompt); setAiOpen(true); };
  const openPerson = (id: string) => { setWho(id); setScope("person"); setSel(null); };
  const improve = (n: GNode) => { setAiText(`Improve "${n.title}": `); setAiOpen(true); };
  const discard = () => { setProposal(null); setAiOut(null); setSel(null); };

  const ordered = useMemo(() => [...graph.nodes].sort((a, b) => a.col - b.col || a.row - b.row), [graph]);
  const into = (id: string) => graph.edges.filter(([, b]) => b === id).map(([a]) => byId.get(a)!).filter(Boolean);
  const out = (id: string) => graph.edges.filter(([a]) => a === id).map(([, b]) => byId.get(b)!).filter(Boolean);
  const detailsFor = (n: GNode) => <Details node={n} from={into(n.id)} to={out(n.id)} byId={byId} go={setSel} askFix={askFix} improve={() => improve(n)} discard={discard} />;

  const subject = scope === "company" ? `Northwind Remote, ${["Oct", "Sep", "Aug", "Jul"][monthIdx]} 2026` : `${person?.name ?? ""} (${who})`;

  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === "Escape") { if (aiOpen) setAiOpen(false); else if (sel) setSel(null); } }}>
      {/* Scope and level of detail */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-foreground/10 px-4 py-2.5 sm:px-5">
        <div role="group" aria-label="Whose workflow" className="inline-flex overflow-hidden rounded-[0.375rem] border border-foreground/20">
          {(["company", "person"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => { setScope(s); setSel(null); }} className={cn(seg, scope === s ? "bg-foreground text-white" : "bg-white hover:bg-muted")}>{s === "company" ? "Company" : "Person"}</button>
          ))}
        </div>
        {scope === "person" && <PersonPicker list={list} value={who} onChange={(id) => { setWho(id); setSel(null); }} />}
        <div role="group" aria-label="Level of detail" className="inline-flex overflow-hidden rounded-[0.375rem] border border-foreground/20">
          {(["simple", "complex", "detailed"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={detail === d} onClick={() => { setDetail(d); setSel(null); }} className={cn(seg, "border-l border-foreground/20 first:border-l-0", detail === d ? "bg-foreground text-white" : "bg-white hover:bg-muted")}>{detailLabels[d]}</button>
          ))}
        </div>
        <p className="hidden min-w-0 flex-1 text-xs text-muted-foreground lg:block">{scope === "company" ? "Everyone, one run." : "One person, every step."} Showing {detailLabels[detail].toLowerCase()} · {subject}</p>
      </div>
      <p className="flex items-start gap-2 border-t border-foreground/10 bg-card px-4 py-2.5 text-muted-foreground sm:px-5">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" />
        <span>
          <b className="font-medium text-foreground">AI only reads what you give it.</b> Every card names where its data is stored and which document it came from; numbers are calculated by plain code.
          <span className="hidden md:inline"> Click a card for its sources, drag it to move it, hold <kbd className="rounded-[0.25rem] border border-foreground/40 px-1.5 text-xs text-foreground">Space</kbd> and drag to pan.</span>
        </span>
      </p>

      {scope === "person" && person ? (
        <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 border-t px-4 py-3 sm:px-5", person.status === "matched" ? "border-foreground/10" : "border-signal/30 bg-signal/[0.04]")}>
          <Avatar code={person.id} name={person.name} size={36} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2"><b className="font-medium">{person.name}</b><span className="text-muted-foreground">{person.id} · {person.job} · {person.kind}</span><StatusChip status={person.status} /></p>
            <p className="mt-0.5 text-muted-foreground"><b className="font-medium text-foreground">{person.status === "matched" ? "Why it is working: " : "Why it is not clear to pay: "}</b>{person.reason}</p>
          </div>
          <button type="button" onClick={() => { const n = byId.get("recon"); if (n) setSel("recon"); else setDetail("complex"); }} className={cn(btn, "shrink-0")}>See the checks</button>
        </div>
      ) : attention.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-foreground/10 px-4 py-2.5 sm:px-5">
          <span className="text-muted-foreground">Needs a person:</span>
          {attention.map((x) => (
            <button key={x.id} type="button" onClick={() => openPerson(x.id)} className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[0.375rem] border border-signal/30 bg-signal/[0.06] pl-1 pr-2.5 text-[0.8125rem] font-medium hover:bg-signal/10">
              <Avatar code={x.id} name={x.name} size={24} />{x.name}<span className="font-normal text-signal">{x.status === "hold" ? "on hold" : "under review"}</span>
            </button>
          ))}
          <span className="text-muted-foreground">Everyone else is working correctly. Pick Person to open any workflow.</span>
        </div>
      ) : (
        <p className="border-t border-foreground/10 px-4 py-2.5 text-muted-foreground sm:px-5">Every workflow in this run is working correctly. Pick Person to open any of them.</p>
      )}
      <div className="flex border-t border-foreground/10 md:hidden" role="group" aria-label="How to show the workflow">
        {(["graph", "list"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={mview === v} onClick={() => setMview(v)} className={cn(seg, "flex-1 border-r border-foreground/10 last:border-r-0", mview === v ? "bg-foreground text-white" : "bg-white")}>{v === "graph" ? "Graph" : "List"}</button>
        ))}
      </div>
      <div className={cn("grid border-t border-foreground/10", selNode && !isPhone && "md:grid-cols-[minmax(0,1fr)_21rem]")}>
        <div className="relative min-w-0">
          {/* AI button and pop-up, in the corner of the graph */}
          <div className="flex flex-wrap justify-end gap-2 px-4 pt-3 md:absolute md:right-3 md:top-3 md:z-30 md:p-0 md:px-0 md:pt-0">
            {moved && <button type="button" onClick={reset} className={cn(btn, "hidden h-9 border-foreground md:inline-flex")}>Reset layout</button>}
            <button type="button" onClick={() => setAiOpen((o) => !o)} aria-expanded={aiOpen} aria-controls="demo-ai" className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[0.375rem] bg-primary px-3.5 text-[0.8125rem] font-medium text-primary-foreground shadow-pop transition-colors hover:bg-signal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 aria-expanded:bg-signal">
              <Sparkles aria-hidden className="size-4 text-orbit" />
              Improve with AI
            </button>
          </div>
          {aiOpen && layer(
            <div id="demo-ai" role="dialog" aria-label="Improve this workflow with AI" className={isPhone ? "fixed inset-x-3 bottom-3 z-[70] max-h-[80vh] overflow-auto rounded-[0.75rem] border border-foreground bg-white/95 p-4 text-[0.8125rem] leading-5 text-foreground shadow-pop backdrop-blur-md" : "z-30 mx-4 mt-2 rounded-[0.5rem] border border-foreground bg-white p-4 shadow-pop md:absolute md:right-3 md:top-14 md:mx-0 md:mt-0 md:w-[26.5rem]"}>
              <div className="flex items-center gap-2 font-medium">
                <Sparkles aria-hidden className="size-4 text-signal" />
                Suggest improvements to the workflow
                <span className="rounded-[0.25rem] border border-foreground/15 px-1.5 text-xs font-normal">Demo</span>
                <button type="button" onClick={() => setAiOpen(false)} aria-label="Close" className="ml-auto grid size-7 cursor-pointer place-items-center rounded-[0.375rem] text-muted-foreground hover:bg-muted"><X aria-hidden className="size-4" /></button>
              </div>
              <label htmlFor="demo-ai-text" className="sr-only">Tell the AI what to change in this workflow</label>
              <textarea id="demo-ai-text" value={aiText} onChange={(e) => setAiText(e.target.value)} rows={3} autoFocus placeholder={`e.g. "${fixPrompt}"`} className="mt-3 w-full resize-y rounded-[0.375rem] border border-foreground/15 bg-card p-2.5 text-[0.8125rem] outline-none focus:border-foreground focus:bg-white" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-[16rem] text-xs leading-snug text-muted-foreground">Demo only: nothing you type is sent anywhere. {join} to subscribe and test this on your own payroll.</p>
                <div className="relative flex">
                  <button type="button" onClick={() => runAi("submit")} className="h-9 cursor-pointer rounded-l-[0.375rem] bg-primary px-4 text-[0.8125rem] font-medium text-primary-foreground hover:bg-signal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">Submit</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} aria-haspopup="menu" aria-expanded={menu} aria-label="More: test" className="grid h-9 w-8 cursor-pointer place-items-center rounded-r-[0.375rem] border-l border-white/25 bg-primary text-primary-foreground hover:bg-signal focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                    <ChevronDown aria-hidden className="size-3.5" />
                  </button>
                  {menu && (
                    <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-10 w-64 rounded-[0.5rem] border border-foreground/10 bg-white p-1.5 shadow-pop">
                      <button type="button" role="menuitem" onClick={() => runAi("test")} className="block w-full cursor-pointer rounded-[0.375rem] px-2.5 py-2 text-left text-[0.8125rem] hover:bg-muted">
                        Test in the demo
                        <span className="block text-xs text-muted-foreground">Preview the change on the graph. Nothing is applied.</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {aiOut && <p role="status" className="mt-3 rounded-[0.375rem] border border-signal bg-signal/[0.06] p-2.5 text-[0.8125rem] leading-snug">{aiOut}</p>}
            </div>,
          )}

          {/* Canvas (md and up) */}
          <div ref={canvasRef} tabIndex={0} role="region" aria-label="Workflow graph. Drag a card to move it. Hold Space and drag to pan, or swipe on a touch screen." className={cn("relative h-[28rem] overflow-auto overscroll-contain bg-card outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] md:block md:h-[36rem]", mview === "list" && "hidden", panClasses)}>
            <div data-pan="bg" className="relative [background-image:radial-gradient(rgb(20_20_19/0.13)_1px,transparent_1px)] [background-size:20px_20px]" style={{ width: board.w * scale, height: board.h * scale }}>
              <div data-pan="bg" className="absolute left-0 top-0 origin-top-left" style={{ width: board.w, height: board.h, transform: `scale(${scale})` }}>
                <svg aria-hidden className="pointer-events-none absolute inset-0" width={board.w} height={board.h}>
                  {graph.edges.map(([a, b]) => {
                    const na = byId.get(a), nb = byId.get(b);
                    if (!na || !nb) return null;
                    const on = hot ? hot.has(a) && hot.has(b) : false;
                    return <path key={`${a}>${b}`} ref={(el) => { if (el) pathEls.current.set(`${a}>${b}`, el); else pathEls.current.delete(`${a}>${b}`); }} d={wirePath(at(na), at(nb))} fill="none" strokeLinecap="round" stroke={on ? "var(--signal)" : "var(--orbit)"} strokeWidth={on ? 3 : 2} strokeOpacity={hot ? (on ? 1 : 0.15) : 0.5} />;
                  })}
                </svg>
                {graph.nodes.map((n) => {
                  const p = at(n);
                  const dim = hot ? !hot.has(n.id) : false;
                  const proposed = n.tone === "prop";
                  return (
                    <div
                      key={n.id}
                      ref={(el) => { if (el) nodeEls.current.set(n.id, el); else nodeEls.current.delete(n.id); }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={sel === n.id}
                      aria-label={`${n.title}, ${n.stat}. Enter for details, arrow keys to move.`}
                      onPointerDown={(e) => down(e, n.id)}
                      onPointerMove={move}
                      onPointerUp={up}
                      onPointerCancel={up}
                      onClick={() => { if (!justDragged.current) setSel(n.id); }}
                      onKeyDown={(e) => keyDown(e, n.id)}
                      style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: W, height: H }}
                      className={cn(
                        "absolute left-0 top-0 cursor-grab touch-pan-x touch-pan-y select-none rounded-[0.5rem] md:touch-none border bg-white text-left transition-[opacity,border-color,box-shadow] duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 data-[dragging=true]:z-20 data-[dragging=true]:cursor-grabbing data-[dragging=true]:border-signal data-[dragging=true]:shadow-pop",
                        proposed ? "border-dashed border-signal bg-[#FFFAF6]" : n.tone === "lock" ? "border-dashed border-foreground/25 bg-transparent" : "border-foreground/10",
                        sel === n.id && "border-signal shadow-[0_0_0_3px_rgb(207_69_0/0.18)]",
                        dim && "opacity-35",
                      )}
                    >
                      <span aria-hidden className="absolute left-[-6px] top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-foreground bg-white" />
                      <span aria-hidden className="absolute right-[-6px] top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-foreground bg-white" />
                      <div className={cn("flex items-center gap-2 rounded-t-[0.4375rem] px-2.5 py-1.5 text-xs", proposed ? "border-b border-dashed border-signal bg-white text-signal" : n.tone === "lock" ? "border-b border-dashed border-foreground/20 text-muted-foreground" : "bg-foreground text-white")}>
                        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", proposed ? "bg-signal" : provDot[n.prov])} />
                        <span className="min-w-0 flex-1 truncate">{n.title}</span>
                      </div>
                      <div className="px-2.5 pt-1.5 text-xs leading-snug text-muted-foreground">
                        <strong className="block truncate text-lg font-medium leading-tight text-foreground [font-variant-numeric:tabular-nums]">{n.stat}</strong>
                        <span className="line-clamp-2">{n.text}</span>
                        <span className={cn("mt-1 inline-block max-w-full truncate rounded-[0.25rem] border px-1.5 align-top text-[0.6875rem]", n.tone === "warn" || proposed ? "border-signal/30 bg-signal/10 text-signal" : "border-foreground/10 bg-muted text-foreground")}>
                          {proposed ? "Proposed, not applied" : n.tone === "warn" ? "Needs a person" : n.tone === "lock" ? "Locked in demo" : provLabel[n.prov]}
                        </span>
                        {n.tag !== provLabel[n.prov] && <span className="ml-1.5 text-[0.6875rem] text-muted-foreground">{n.tag}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* The same graph as a plain list (small screens): each item says where it comes from */}
          <ol className={cn("gap-2 p-4 md:hidden", mview === "list" ? "grid" : "hidden")}>
            {ordered.map((n, i) => {
              const prev = ordered[i - 1];
              const srcs = into(n.id);
              return (
                <li key={n.id}>
                  {n.group !== prev?.group && <p className="mb-1.5 mt-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{n.group}</p>}
                  <button type="button" onClick={() => setSel(n.id)} aria-pressed={sel === n.id} className={cn("w-full cursor-pointer rounded-[0.5rem] border bg-white p-3 text-left", sel === n.id ? "border-signal" : "border-foreground/10", n.tone === "prop" && "border-dashed border-signal")}>
                    <span className="flex items-baseline justify-between gap-3">
                      <b className="font-medium">{n.title}</b>
                      <span className="shrink-0 text-xs text-muted-foreground">{n.tag}</span>
                    </span>
                    <span className="mt-0.5 block text-lg font-medium leading-tight [font-variant-numeric:tabular-nums]">{n.stat}</span>
                    <span className="block text-muted-foreground">{n.text}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={cn("rounded-[0.25rem] border px-1.5", n.tone === "warn" ? "border-signal/30 bg-signal/10 text-signal" : "border-foreground/10 bg-muted")}>{n.tone === "warn" ? "Needs a person" : provLabel[n.prov]}</span>
                      {srcs.length > 0 && <span className="text-muted-foreground">from {srcs.map((s) => s.title).join(", ")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {selNode && !isPhone && (
          <aside aria-label="Card details" className="relative max-h-[36rem] overflow-auto border-l border-foreground/10 bg-white p-5">
            <button type="button" onClick={() => setSel(null)} aria-label="Close details" className="absolute right-3 top-3 grid size-7 cursor-pointer place-items-center rounded-[0.375rem] border border-foreground/10 text-muted-foreground hover:border-foreground hover:text-foreground"><X aria-hidden className="size-4" /></button>
            {detailsFor(selNode)}
          </aside>
        )}
      </div>
      {selNode && isPhone && layer(
        <div className="fixed inset-0 z-50 flex items-end bg-foreground/25" onClick={() => setSel(null)}>
          <div role="dialog" aria-modal="true" aria-label={`${selNode.title} details`} onClick={(e) => e.stopPropagation()} className="relative max-h-[78vh] w-full overflow-auto rounded-t-[0.75rem] border-t border-foreground/10 bg-white/85 p-4 pb-8 text-foreground shadow-pop backdrop-blur-md">
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-[0.125rem] bg-foreground/20" />
            <button type="button" autoFocus onClick={() => setSel(null)} aria-label="Close details" className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-[0.375rem] border border-foreground/15 bg-white/80 text-muted-foreground hover:border-foreground hover:text-foreground"><X aria-hidden className="size-4" /></button>
            {detailsFor(selNode)}
          </div>
        </div>,
      )}
    </div>
  );
}

function Src({ node, go }: { node: GNode; go: (id: string) => void }) {
  return (
    <button type="button" onClick={() => go(node.id)} className="mr-1 mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-[0.25rem] border border-foreground bg-white px-1.5 text-[0.6875rem] leading-5 hover:bg-foreground hover:text-white">
      <span aria-hidden className="size-1.5 rounded-full bg-signal" />
      {node.title}
    </button>
  );
}
const Sec = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 mt-4 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;

function Details({ node, from, to, byId, go, askFix, improve, discard }: { node: GNode; from: GNode[]; to: GNode[]; byId: Map<string, GNode>; go: (id: string) => void; askFix: () => void; improve: () => void; discard: () => void }) {
  const i = node.info;
  return (
    <div className="text-[0.8125rem] leading-5">
      <h4 className="pr-8 text-lg font-medium tracking-tight">{node.title}</h4>
      <p className="mb-3 text-muted-foreground">{i.sub}</p>

      <p className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-[0.25rem] border px-1.5 text-xs font-medium", node.tone === "warn" ? "border-signal/30 bg-signal/10 text-signal" : "border-foreground/15 bg-muted")}>{provLabel[node.prov]}</span>
        <span className="text-xs text-muted-foreground">{provHelp[node.prov]}</span>
      </p>
      <dl className="mt-3 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 rounded-[0.375rem] bg-muted p-2.5">
        <dt className="text-muted-foreground">Stored in</dt><dd className="min-w-0 break-words">{node.store}</dd>
        <dt className="text-muted-foreground">Comes from</dt><dd className="min-w-0 break-words">{node.from}</dd>
      </dl>

      {i.lines?.map((l) => <p key={l} className="mt-3">{l}</p>)}
      {i.calc && (
        <table className="mt-3 w-full [font-variant-numeric:tabular-nums]">
          <tbody>
            {i.calc.map((r) => (
              <tr key={r.k}>
                <td className="border-b border-foreground/10 py-1.5 pr-3 align-top">{r.k}{r.src?.map((id) => byId.get(id)).filter((x): x is GNode => !!x).map((s) => <Src key={s.id} node={s} go={go} />)}</td>
                <td className="whitespace-nowrap border-b border-foreground/10 py-1.5 text-right">{r.v}</td>
              </tr>
            ))}
            {i.total && (
              <tr className="font-semibold">
                <td className="border-t-2 border-foreground pt-2 pr-3">{i.total.k}</td>
                <td className="whitespace-nowrap border-t-2 border-foreground pt-2 text-right">{i.total.v}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {i.note && <p className="mt-3 rounded-[0.375rem] bg-muted p-2.5">{i.note}</p>}

      {node.id === "recon" && node.tone === "warn" && (
        <button type="button" onClick={askFix} className={cn(btn, "mt-3")}><Sparkles aria-hidden className="mr-1.5 size-3.5 text-signal" />Ask AI to fix this</button>
      )}
      {node.id !== "prop" && !(node.id === "recon" && node.tone === "warn") && (
        <button type="button" onClick={improve} className={cn(btn, "mt-3")}><Sparkles aria-hidden className="mr-1.5 size-3.5 text-signal" />Improve this step with AI</button>
      )}
      {node.id === "prop" && <button type="button" onClick={discard} className={cn(btn, "mt-3")}>Discard</button>}

      {from.length > 0 && (<><Sec>Comes from</Sec><p>{from.map((s) => <Src key={s.id} node={s} go={go} />)}</p></>)}
      {to.length > 0 && (<><Sec>Feeds</Sec><p>{to.map((s) => <Src key={s.id} node={s} go={go} />)}</p></>)}
    </div>
  );
}
