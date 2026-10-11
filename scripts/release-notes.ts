import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Reads committed objects only; never tags, fetches, deploys or loads application env. */
export function generateReleaseNotes(repo: string, ref: string, previous: string): string {
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: repo, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
      GIT_NO_LAZY_FETCH: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1" },
  });
  const commit = (value: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/.test(value)) throw new Error("Invalid ref");
    try { return git("rev-parse", "--verify", "--end-of-options", `${value}^{commit}`).toString("utf8").trim(); }
    catch { throw new Error("Ref does not resolve to a local commit"); }
  };
  const head = commit(ref), base = commit(previous);
  try { git("merge-base", "--is-ancestor", base, head); }
  catch { throw new Error("Previous commit must be an ancestor of candidate"); }
  const migrations = (sha: string) => {
    const paths = git("ls-tree", "-r", "--name-only", "-z", sha, "--", "supabase/migrations").toString("utf8").split("\0").filter(Boolean).sort();
    return new Map(paths.map(path => {
      if (!/^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(path)) throw new Error("Invalid migration filename");
      return [path, createHash("sha256").update(git("cat-file", "blob", `${sha}:${path}`)).digest("hex")];
    }));
  };
  const current = migrations(head), prior = migrations(base);
  for (const [path, hash] of prior) if (current.get(path) !== hash) throw new Error("Historical migration changed or removed");
  return ["# Release candidate", "", `Candidate commit: ${head}`, `Previous commit: ${base}`, "",
    "Owner release pending: gate evidence, target migration history, backup/rollback evidence, release tag and hosting-plan confirmation are not supplied by this generator.", "",
    "| Migration | SHA-256 of committed bytes | Change |", "|---|---|---|",
    ...[...current].map(([path, hash]) => `| ${path.slice("supabase/migrations/".length)} | ${hash} | ${prior.has(path) ? "existing" : "new"} |`), ""].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== "--ref" || args[2] !== "--previous") throw new Error("Usage: node scripts/release-notes.ts --ref <commit-or-ref> --previous <commit-or-ref>");
    process.stdout.write(generateReleaseNotes(process.cwd(), args[1], args[3]));
  } catch (error) {
    // Git errors can contain local configuration; emit only our own bounded diagnostic.
    const message = error instanceof Error && /^(Invalid ref|Ref does not resolve|Previous commit|Historical migration|Invalid migration|Usage:)/.test(error.message) ? error.message : "Release notes could not read local committed objects";
    console.error(message);
    process.exitCode = 1;
  }
}
