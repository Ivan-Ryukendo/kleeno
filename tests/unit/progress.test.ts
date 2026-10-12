import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const tempRoot = resolve(process.env.TEMP ?? process.env.TMP ?? ".tools/tmp");
const fixtures: string[] = [];
const script = resolve("scripts/progress.mjs");
function repository() {
  mkdirSync(tempRoot, { recursive: true });
  const repo = mkdtempSync(resolve(tempRoot, "progress-"));
  fixtures.push(repo);
  execFileSync("git", ["init", "--quiet", repo], { stdio: "pipe" });
  mkdirSync(resolve(repo, "docs"));
  writeFileSync(resolve(repo, "docs/roadmap.md"), `<!-- LEDGER:START -->
| ID | Task | Phase | Wave | Lane | Risk | Agent | Status | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | owner task | R1 | W1 | OWNER | L | any | todo | - |
| B | backend task | R1 | W1 | BE | L | any | todo | - |
NEXT: old
<!-- LEDGER:END -->`);
  writeFileSync(resolve(repo, "PROGRESS.md"), "<!-- BOARD:START -->\nold\n<!-- BOARD:END -->");
  return { repo, run: (...args: string[]) => execFileSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" }) };
}
afterEach(() => {
  for (const repo of fixtures.splice(0)) {
    if (!repo.startsWith(`${tempRoot}/`) && !repo.startsWith(`${tempRoot}\\`)) throw new Error("fixture escaped temp root");
    rmSync(repo, { recursive: true, force: true });
  }
});

it("filters READY, NEXT and details by lane, including lowercase and empty lanes", () => {
  const { run } = repository();
  const output = run("--ready", "be");
  expect(output).toContain("READY (1, can run in parallel): B [BE/L]");
  expect(output).toContain("NEXT: B — backend task");
  expect(output).toContain("B  W1 BE/L  any  backend task");
  expect(output).not.toContain("owner task");
  const empty = run("--ready", "OPS");
  expect(empty).toContain("READY (0, can run in parallel): none");
  expect(empty).toContain("NEXT: (nothing ready: see IN PROGRESS / BLOCKED)");
  expect(empty).not.toContain("NEXT: A");
});

it("keeps unfiltered output and --write board and ledger NEXT global", () => {
  const { repo, run } = repository();
  expect(run("--ready")).toContain("READY (2, can run in parallel): A [OWNER/L], B [BE/L]");
  expect(run("--ready", "BE", "--write")).toContain("NEXT: B — backend task");
  expect(readFileSync(resolve(repo, "PROGRESS.md"), "utf8")).toContain("READY (2, can run in parallel): A [OWNER/L], B [BE/L]");
  expect(readFileSync(resolve(repo, "docs/roadmap.md"), "utf8")).toContain("NEXT: A — owner task");
});
