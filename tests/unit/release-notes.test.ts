import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateReleaseNotes } from "../../scripts/release-notes";

const tempRoot = resolve(process.env.TEMP ?? process.env.TMP ?? ".tools/tmp");
const fixtures: string[] = [];
const script = resolve("scripts/release-notes.ts");
function repository() {
  mkdirSync(tempRoot, { recursive: true });
  const repo = mkdtempSync(resolve(tempRoot, "r5-release-"));
  fixtures.push(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  mkdirSync(resolve(repo, "supabase/migrations"), { recursive: true });
  const put = (name: string, body: string) => writeFileSync(resolve(repo, "supabase/migrations", name), body);
  const commit = () => { git("add", "supabase"); git("commit", "--quiet", "-m", "fixture"); return git("rev-parse", "HEAD"); };
  put("20261001000001_initial.sql", "select 1;\n");
  const previous = commit();
  put("20261003000001_last.sql", "select 3;\n");
  put("20261002000001_next.sql", "select 2;\n");
  const candidate = commit();
  return { repo, git, put, commit, previous, candidate };
}
afterEach(() => {
  for (const repo of fixtures.splice(0)) {
    if (!repo.startsWith(`${tempRoot}/`) && !repo.startsWith(`${tempRoot}\\`)) throw new Error("fixture escaped temp root");
    rmSync(repo, { recursive: true, force: true });
  }
});

describe("offline release notes", () => {
  it("binds refs to commits and hashes sorted committed migration bytes, ignoring dirty files", () => {
    const r = repository();
    r.git("branch", "candidate", r.candidate);
    r.git("tag", "previous", r.previous);
    r.put("20261002000001_next.sql", "dirty changed bytes");
    r.put("20261004000001_untracked.sql", "untracked bytes");
    const notes = generateReleaseNotes(r.repo, "candidate", "previous");
    expect(notes).toContain(`Candidate commit: ${r.candidate}`);
    expect(notes).toContain(`Previous commit: ${r.previous}`);
    const files = ["20261001000001_initial.sql", "20261002000001_next.sql", "20261003000001_last.sql"];
    expect(files.map(name => notes.indexOf(name))).toEqual([...files.map(name => notes.indexOf(name))].sort((a, b) => a - b));
    expect(notes).toContain(createHash("sha256").update("select 2;\n").digest("hex"));
    expect(notes).not.toContain("untracked");
    expect(notes).toContain("Owner release pending");
  });

  it("rejects invalid refs, a non-ancestor previous commit and modified historical migrations", () => {
    const r = repository();
    expect(() => generateReleaseNotes(r.repo, "missing-ref", r.previous)).toThrow();
    expect(() => generateReleaseNotes(r.repo, "--all", r.previous)).toThrow("Invalid ref");
    expect(() => generateReleaseNotes(r.repo, r.previous, r.candidate)).toThrow("Previous commit must be an ancestor");
    r.put("20261001000001_initial.sql", "select 999;\n");
    const changed = r.commit();
    expect(() => generateReleaseNotes(r.repo, changed, r.previous)).toThrow("Historical migration changed or removed");
  });

  it("rejects removed historical migrations and malformed migration filenames", () => {
    const r = repository();
    rmSync(resolve(r.repo, "supabase/migrations/20261001000001_initial.sql"));
    expect(() => generateReleaseNotes(r.repo, r.commit(), r.previous)).toThrow("Historical migration changed or removed");
    r.put("unsafe name.sql", "select 4;\n");
    expect(() => generateReleaseNotes(r.repo, r.commit(), r.candidate)).toThrow("Invalid migration filename");
  });

  it("CLI emits candidate notes without changing worktree, refs, remotes or hook files", () => {
    const r = repository();
    const marker = resolve(r.repo, ".git/hooks/release-marker");
    writeFileSync(marker, "unchanged");
    const before = [r.git("status", "--porcelain"), r.git("show-ref"), r.git("remote", "-v")];
    const result = spawnSync(process.execPath, [script, "--ref", r.candidate, "--previous", r.previous], { cwd: r.repo, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Candidate commit: ${r.candidate}`);
    expect([r.git("status", "--porcelain"), r.git("show-ref"), r.git("remote", "-v")]).toEqual(before);
    expect(readFileSync(marker, "utf8")).toBe("unchanged");
    const invalid = spawnSync(process.execPath, [script, "--ref", "--all"], { cwd: r.repo, encoding: "utf8" });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Usage:");
  });
});
