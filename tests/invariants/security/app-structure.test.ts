// PROTECTED. S15 (every handler authenticates, no Server Actions, proxy is not auth), S24 (no raw HTML injection),
// S41 (only db repositories call crypto), core purity (FILE-STRUCTURE rules).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
function files(dir: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name).replaceAll("\\", "/");
    if (e.isDirectory()) return files(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const src = files("src");
const routes = src.filter((f) => f.startsWith("src/app/api/") && f.endsWith("/route.ts"));

/** Routes that may skip the session check. Each one must use `openRoute` and is listed here on purpose. */
const OPEN_ROUTES = [
  "src/app/api/auth/login/route.ts",
  "src/app/api/auth/oauth/google/route.ts", // P4g: only builds the Google authorize URL; the account is checked at /auth/callback (S74)
  "src/app/api/invites/accept/route.ts", // P3b: public, but only with a valid one-time invite token (S62)
  // W: public waitlist (rate-limited, S53–S55) and the admin password step (behind the secret-path gate, S52)
  "src/app/api/waitlist/route.ts",
  "src/app/api/waitlist/survey/route.ts",
  "src/app/api/admin/login/route.ts",
  "src/app/api/circle/webhook/route.ts", // P4: Circle signs the raw body (S27); the handler only triggers a re-check
  "src/app/api/x402/verify/route.ts", // P4 slice 6: Kleeno Verify is public and paid over x402: no session, the price + rate limit + unguessable target gate it (S68)
]; // the receipt page is a page, not a route: it checks its own signed token (S36)

describe("S15 handlers", () => {
  it("there are route handlers to check", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every route handler is wrapped by the auth guard, or is on the open allowlist", () => {
    for (const f of routes) {
      const text = read(f);
      const open = OPEN_ROUTES.includes(f);
      expect(open ? /openRoute\(/.test(text) : /guarded[<(]/.test(text) && !/openRoute\(/.test(text), f).toBe(true);
    }
  });

  it("S52: admin routes are scoped to the admin gate; waitlist routes are the only other non-app scope", () => {
    for (const f of routes) {
      const scope = read(f).match(/scope: "(\w+)"/)?.[1] ?? "app";
      const expected = f.startsWith("src/app/api/admin/") ? "admin" : f.startsWith("src/app/api/waitlist/") || f === "src/app/api/waitlist/route.ts" ? "waitlist" : "app";
      expect(scope, f).toBe(expected);
    }
  });

  it("route files export only HTTP methods (no un-guarded helper handlers)", () => {
    for (const f of routes) {
      const exported = [...read(f).matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
      expect(exported.filter((n) => !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(n)), f).toEqual([]);
    }
  });

  it("no Server Actions anywhere", () => {
    expect(src.filter((f) => /["']use server["']/.test(read(f)))).toEqual([]);
  });

  it("proxy.ts does not make authorization decisions from roles or the database", () => {
    const p = read("src/proxy.ts");
    expect(p).not.toMatch(/app_users|role/);
    expect(p).not.toContain("SERVICE_ROLE");
  });

  it("mutations never take company, role or state from the request body", () => {
    for (const f of routes) {
      const text = read(f);
      expect(text, f).not.toMatch(/body\.(companyId|company_id|role|status|state)\b/);
    }
  });
});

describe("S24 plain-text rendering", () => {
  it("no dangerouslySetInnerHTML in src", () => {
    expect(src.filter((f) => read(f).includes("dangerouslySetInnerHTML"))).toEqual([]);
  });
});

describe("S41 crypto isolation", () => {
  it("only src/server/db, the crypto module itself and key scripts import the crypto module", () => {
    const users = [...src, ...files("scripts")].filter((f) => /from ["']@\/server\/crypto(\/cipher)?["']/.test(read(f)) || /from ["']\.\/crypto\/cipher["']/.test(read(f)));
    const outside = users.filter((f) => !f.startsWith("src/server/db/") && !f.startsWith("src/server/crypto/") && f !== "src/server/env.ts" && !f.startsWith("scripts/"));
    expect(outside).toEqual([]);
  });
});

describe("core purity", () => {
  const banned = /from ["'](@\/server|@\/app|next|next\/|@supabase|@circle-fin|viem|server-only|\.\.\/\.\.\/server)/;
  it("src/core imports no server, framework, database, Circle or chain code", () => {
    expect(files("src/core").filter((f) => banned.test(read(f)))).toEqual([]);
  });
  it("src/core/validation never imports src/core/ai", () => {
    expect(files("src/core/validation").filter((f) => /core\/ai|\.\.\/ai/.test(read(f)))).toEqual([]);
  });
  it("src/core names no vendor and never imports src/server/integrations", () => {
    expect(files("src/core").filter((f) => /server\/integrations|\b(bamboohr|gusto|deel|xero|quickbooks|workday)\b/i.test(read(f)))).toEqual([]);
  });
});
