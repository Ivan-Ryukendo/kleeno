import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ click: null as (() => Promise<void>) | null, state: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, calls.state] }));
vi.mock("@/components/ui/button", () => ({ Button: ({ onClick }: { onClick: () => Promise<void> }) => { calls.click = onClick; return null; } }));
import { EvidencePackDownload } from "@/components/evidence-pack-download";

const link = { href: "", download: "", click: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers(); calls.state.mockReset(); link.click.mockReset();
  vi.stubGlobal("document", { createElement: () => link });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("downloads only a hash-verified ZIP and releases its temporary URL", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "content-type": "application/zip", "x-content-sha256": createHash("sha256").update(bytes).digest("hex") } })));
  renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: true }));
  await calls.click!();
  expect(link.download).toBe("kleeno-signed-calculation-v1-run-1.zip");
  expect(link.click).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});

it("announces changed access and closes parent protected content without downloading", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
  const onDenied = vi.fn();
  renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: true, onDenied }));
  await calls.click!();
  expect(onDenied).toHaveBeenCalledWith(expect.stringContaining("Review access changed"));
  expect(link.click).not.toHaveBeenCalled();
});

it("refuses tampered bytes and keeps download blocked until prerequisite evidence exists", async () => {
  const fetch = vi.fn(async () => new Response("not evidence", { headers: { "content-type": "application/zip", "x-content-sha256": "a".repeat(64) } }));
  vi.stubGlobal("fetch", fetch);
  renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: true }));
  await calls.click!();
  expect(calls.state).toHaveBeenCalledWith(expect.stringContaining("integrity check"));
  expect(link.click).not.toHaveBeenCalled();
  fetch.mockClear();
  renderToStaticMarkup(createElement(EvidencePackDownload, { runId: "run-1", available: false }));
  await calls.click!();
  expect(fetch).not.toHaveBeenCalled();
});
