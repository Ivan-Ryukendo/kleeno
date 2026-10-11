import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const config = pathToFileURL(path.resolve("vitest.db.config.ts")).href;
const loader = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;

function load(target?: string, testRef?: string, ownerFile = false) {
  const dir = mkdtempSync(path.join(tmpdir(), "kleeno-db-config-"));
  try {
    if (ownerFile) writeFileSync(path.join(dir, ".env"), "SUPABASE_URL=http://127.0.0.1:54321\n");
    const program = `process.env = new Proxy(process.env, { get(target, key) { if (typeof key === 'string' && key.startsWith('SUPABASE_PROD_')) throw new Error('production environment accessed'); return Reflect.get(target, key); } }); await import(${JSON.stringify(config)});`;
    return spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e", program], {
      cwd: dir,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(), ...(target && { SUPABASE_URL: target }), ...(testRef && { SUPABASE_TEST_PROJECT_REF: testRef }) },
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("database test environment isolation", () => {
  it("does not read production variables when validating loopback", () => {
    const result = load("http://127.0.0.1:54321");
    expect(result.stderr).not.toContain("production environment accessed");
    expect(result.status).toBe(0);
  });
  it("does not load the owner .env as a fallback", () => {
    const result = load(undefined, undefined, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Database tests require");
  });
  it("accepts only the explicitly pinned hosted test project", () => {
    expect(load("https://axcgcjpmcdujxkvroqox.supabase.co", "axcgcjpmcdujxkvroqox").status).toBe(0);
    expect(load("https://other-project.supabase.co", "other-project").status).not.toBe(0);
    expect(load("https://axcgcjpmcdujxkvroqox.supabase.co").status).not.toBe(0);
  });
});
