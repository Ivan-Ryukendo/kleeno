import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
const harness = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, post: vi.fn(), refresh: vi.fn() }));
vi.mock("react", async importOriginal => ({ ...await importOriginal<typeof import("react")>(), useState: (initial: unknown) => { const index = harness.cursor++; if (!(index in harness.states)) harness.states[index] = initial; return [harness.states[index], (value: unknown) => { harness.states[index] = value; }]; }, useRef: () => ({ current: null }), useEffect: () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/lib/api", () => ({ postJson: harness.post }));
import { BillingCollectionPanel } from "@/components/billing-collection-panel";
type Node = ReactElement<{ children?: unknown; onSubmit?: (event: { preventDefault(): void }) => Promise<void>; onClick?: () => Promise<void> }>;
function nodes(value: unknown): Node[] { if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== "object" || !("props" in value)) return []; const node = value as Node; return [node, ...nodes(node.props.children)]; }
const history = [{ id: "command", action: "usage", idempotencyKey: "key", stage: 0, status: "UNKNOWN", month: "2026-09-01", sourceHash: "a".repeat(64), amountCents: 200, uniqueWorkers: 1, invoiceId: "in_fixture", invoiceStatus: "draft", checkoutId: null, usageReconciliation: "MATCHED" }];
function render() { harness.cursor = 0; return BillingCollectionPanel({ configured: true, linked: true, billable: true, baseCents: 4900, history }); }
beforeEach(() => {
  vi.clearAllMocks(); harness.states = ["usage", "2026-09", { month: "2026-09-01", amountCents: 200, uniqueWorkers: 1, sourceHash: "a".repeat(64) }, "password", false, false, null, "Prior success", "https://checkout.stripe.com/fixture", "command", "in_fixture"];
  vi.stubGlobal("requestAnimationFrame", () => 0);
});
afterEach(() => vi.unstubAllGlobals());
for (const status of [401, 403]) for (const path of ["quote", "collect", "recovery"]) it(`${path} ${status} removes prior checkout, quote, password, notes and recorded actions`, async () => {
  harness.post.mockResolvedValue({ ok: false, status, error: "Access denied" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Access denied" } }), { status })));
  const tree = nodes(render());
  if (path === "quote") await tree.find(node => node.props.onClick)?.props.onClick?.();
  else { const forms = tree.filter(node => node.type === "form"); await forms[path === "collect" ? 0 : 1].props.onSubmit?.({ preventDefault() {} }); }
  const after = nodes(render());
  expect(after.some(node => node.type === "form" || node.type === "details" || node.type === "a")).toBe(false);
  expect(harness.states[2]).toBeNull(); expect(harness.states[3]).toBe(""); expect(harness.states[7]).toBeNull(); expect(harness.states[8]).toBeNull();
});
for (const invalid of [{ uniqueWorkers: -1 }, { uniqueWorkers: 10001 }, { uniqueWorkers: 1.5 }, { amountCents: 100_000_001 }]) it(`rejects out-of-bounds usage quote ${JSON.stringify(invalid)} before invoice confirmation`, async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ month: "2026-09-01", amountCents: 200, uniqueWorkers: 1, sourceHash: "a".repeat(64), ...invalid }))));
  await nodes(render()).find(node => node.props.onClick)?.props.onClick?.();
  expect(harness.states[2]).toBeNull(); expect(harness.states[6]).toContain("incomplete");
});
