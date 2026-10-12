// PROTECTED. S44: the one path that can delete immutable data exists only in scripts/delete-company.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const files = (dir: string): string[] => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []));

describe("S44 deletion path", () => {
  it("workspace deletion preserves global identities and other company access", () => {
    const script = readFileSync(path.join(root, "scripts/delete-company.ts"), "utf8");
    expect(script).not.toMatch(/auth\.admin\.deleteUser|from\(["']users["']\)/);
  });

  it("delete_company is called only by scripts/delete-company.ts (never by the app)", () => {
    const callers = [...files("src"), ...files("scripts")].filter((f) => readFileSync(path.join(root, f), "utf8").includes("delete_company"));
    expect(callers).toEqual(["scripts/delete-company.ts"]);
  });

  it("the function is granted to the service role only", () => {
    const sql = readFileSync(path.join(root, "supabase/migrations/20261002000005_delete_company.sql"), "utf8");
    expect(sql).toMatch(/revoke all on function public\.delete_company\(uuid\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.delete_company\(uuid\) to service_role/);
  });
});
