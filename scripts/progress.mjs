// Roadmap progress board. Reads the ledger in docs/roadmap.md and the claim files in docs/progress/
// of the HUB checkout (the main repo folder), so it gives the same answer from any task worktree.
// Usage: node scripts/progress.mjs [--phases] [--ready [LANE]] [--write]
//   --write  regenerates the board in PROGRESS.md and the NEXT line in the ledger (the only writes).
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STALE_HOURS = 2;
const STATUSES = ["done", "active", "blocked", "todo", "cut"];
const args = process.argv.slice(2);

const hub = dirname(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim());
const roadmapPath = join(hub, "docs/roadmap.md");
const progressPath = join(hub, "PROGRESS.md");
const claimsDir = join(hub, "docs/progress");

const roadmap = readFileSync(roadmapPath, "utf8");
const [before, rest] = roadmap.split("<!-- LEDGER:START -->");
const block = rest?.split("<!-- LEDGER:END -->")[0];
if (!block) fail("No ledger found in docs/roadmap.md (missing LEDGER markers).");

const lines = block.split("\n").filter((l) => l.trim().startsWith("|"));
const header = cells(lines[0]).map((h) => h.toLowerCase());
const col = (name) => header.indexOf(name);
for (const name of ["id", "task", "phase", "status", "depends on"]) if (col(name) < 0) fail(`Ledger has no "${name}" column.`);

const rows = lines
  .slice(1)
  .map(cells)
  .filter((c) => STATUSES.includes((c[col("status")] ?? "").toLowerCase()))
  .map((c) => ({
    id: c[col("id")],
    task: c[col("task")],
    phase: c[col("phase")],
    wave: col("wave") >= 0 ? c[col("wave")] : "",
    lane: col("lane") >= 0 ? c[col("lane")] : "",
    risk: col("risk") >= 0 ? c[col("risk")] : "",
    agent: col("agent") >= 0 ? c[col("agent")] : "",
    status: c[col("status")].toLowerCase(),
    deps: (c[col("depends on")] ?? "").split(",").map((d) => d.trim()).filter((d) => d && d !== "-"),
  }));
const byId = new Map(rows.map((r) => [r.id, r]));

// Claim files: docs/progress/<ID>.md. Their mtime is the heartbeat.
const claims = new Map();
if (existsSync(claimsDir)) {
  for (const f of readdirSync(claimsDir).filter((f) => f.endsWith(".md") && !f.startsWith("_"))) {
    const id = f.slice(0, -3);
    const text = readFileSync(join(claimsDir, f), "utf8");
    const hours = (Date.now() - statSync(join(claimsDir, f)).mtimeMs) / 36e5;
    claims.set(id, {
      agent: text.match(/^Agent:\s*(.+)$/m)?.[1].split("·")[0].trim() ?? "?",
      state: text.match(/^State:\s*(\S+)/m)?.[1] ?? "?",
      hours,
    });
  }
}

const isDone = (id) => ["done", "cut"].includes(byId.get(id)?.status);
const ready = rows.filter((r) => r.status === "todo" && !claims.has(r.id) && r.deps.every(isDone));
const counted = rows.filter((r) => r.status !== "cut");
const done = counted.filter((r) => r.status === "done").length;

const out = [];
out.push(`Roadmap  ${bar(done, counted.length)}  ${pct(done, counted.length)}%  (${done}/${counted.length} tasks)`);
out.push(STATUSES.map((s) => `${s} ${rows.filter((r) => r.status === s).length}`).join(" · "));
for (const [id, c] of claims) {
  if (isDone(id) || ["superseded", "merged"].includes(c.state)) continue;
  const stale = c.hours > STALE_HOURS ? `  STALE ${c.hours.toFixed(1)}h: may be taken over` : "";
  out.push(`IN PROGRESS: ${id} ${byId.get(id)?.task ?? "(not in ledger)"} [${c.agent}, ${c.state}, ${ago(c.hours)}]${stale}`);
}
for (const r of rows.filter((r) => r.status === "blocked")) out.push(`BLOCKED: ${r.id} ${r.task}`);
out.push(...readyLines(ready));
const nextLine = out.at(-1);
const boardLines = [...out];

if (args.includes("--phases")) {
  for (const p of [...new Set(counted.map((r) => r.phase))]) {
    const inPhase = counted.filter((r) => r.phase === p);
    const d = inPhase.filter((r) => r.status === "done").length;
    out.push(`${p.padEnd(6)} ${bar(d, inPhase.length, 12)} ${String(pct(d, inPhase.length)).padStart(3)}%  ${d}/${inPhase.length}`);
  }
}

const readyIdx = args.indexOf("--ready");
if (readyIdx >= 0) {
  const lane = args[readyIdx + 1] && !args[readyIdx + 1].startsWith("--") ? args[readyIdx + 1].toUpperCase() : null;
  const selectedReady = ready.filter((r) => !lane || r.lane.toUpperCase() === lane);
  out.splice(boardLines.length - 2, 2, ...readyLines(selectedReady));
  out.push(`-- ready tasks${lane ? ` in lane ${lane}` : ""} --`);
  for (const r of selectedReady) {
    out.push(`${r.id}  ${r.wave} ${r.lane}/${r.risk}  ${r.agent}  ${r.task}`);
  }
}

console.log(out.join("\n"));

if (args.includes("--write")) {
  const newBlock = block.replace(/^NEXT:.*$/m, nextLine);
  writeFileSync(roadmapPath, before + "<!-- LEDGER:START -->" + newBlock + "<!-- LEDGER:END -->" + rest.split("<!-- LEDGER:END -->")[1]);
  const progress = readFileSync(progressPath, "utf8");
  const board = ["<!-- BOARD:START -->", "```text", ...boardLines, "```", `Board generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`node scripts/progress.mjs --write\`; do not edit by hand.`, "<!-- BOARD:END -->"].join("\n");
  if (!progress.includes("<!-- BOARD:START -->")) fail("PROGRESS.md has no BOARD markers.");
  writeFileSync(progressPath, progress.replace(/<!-- BOARD:START -->[\s\S]*?<!-- BOARD:END -->/, board));
  console.log("Wrote PROGRESS.md board and ledger NEXT line.");
}

function readyLines(tasks) {
  const shown = tasks.slice(0, 8);
  const next = tasks[0];
  return [
    `READY (${tasks.length}, can run in parallel): ${shown.map((r) => `${r.id}${r.lane ? ` [${r.lane}${r.risk ? `/${r.risk}` : ""}]` : ""}`).join(", ") || "none"}${tasks.length > shown.length ? ", …" : ""}`,
    next ? `NEXT: ${next.id} — ${next.task}` : "NEXT: (nothing ready: see IN PROGRESS / BLOCKED)",
  ];
}
function cells(line) {
  return line.split("|").slice(1, -1).map((c) => c.trim());
}
function bar(d, total, width = 24) {
  const filled = total ? Math.round((d / total) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}
function pct(d, total) {
  return total ? Math.round((d / total) * 100) : 0;
}
function ago(h) {
  return h < 1 ? `${Math.round(h * 60)} min ago` : `${h.toFixed(1)} h ago`;
}
function fail(msg) {
  console.error(msg);
  process.exit(1);
}
