// PROTECTED. Security control S37 (docs/security.md §2).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const PUBLIC_ENV_ALLOWLIST = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("S37 secrets", () => {
  it("every src/server file imports server-only", () => {
    const missing = files(path.join(root, "src/server")).filter(
      (f) => !/^import ["']server-only["'];?$/m.test(readFileSync(f, "utf8")),
    );
    expect(missing).toEqual([]);
  });

  it("NEXT_PUBLIC_ is used only for the allowlisted public values", () => {
    const sources = [...files(path.join(root, "src")), path.join(root, ".env.example")];
    const found = new Set(
      sources.flatMap((f) => readFileSync(f, "utf8").match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []),
    );
    expect([...found].filter((n) => !PUBLIC_ENV_ALLOWLIST.includes(n))).toEqual([]);
  });

  it(".env.example holds names only", () => {
    const withValues = readFileSync(path.join(root, ".env.example"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("#") && !/^[A-Z0-9_]+=\s*$/.test(l));
    expect(withValues).toEqual([]);
  });
});
