// S74 (P4g): /auth/callback and the Google start route exist only in app mode, and the admin area refuses sessions without `password`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const saved = process.env.SITE_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.SITE_MODE;
  else process.env.SITE_MODE = saved;
});

const hit = (p: string) => proxy(new NextRequest(`http://localhost:3000${p}`));
const isRewriteTo404 = (res: Response) => res.headers.get("x-middleware-rewrite")?.replace(/\/$/, "").endsWith("/kleeno-not-found") === true;

describe("S74 waitlist mode", () => {
  it("/auth/callback is the same 404 as any unknown page, with or without a query", async () => {
    delete process.env.SITE_MODE;
    for (const p of ["/auth/callback", "/auth/callback/", "/%61uth/callback", "/auth/callback/x"]) expect(isRewriteTo404(await hit(p)), p).toBe(true);
    process.env.SITE_MODE = "waitlist";
    expect(isRewriteTo404(await hit("/auth/callback"))).toBe(true);
  });
  it("the Google start API is a JSON 404", async () => {
    delete process.env.SITE_MODE;
    const res = await hit("/api/auth/oauth/google");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
  it("public pages are unaffected", async () => {
    delete process.env.SITE_MODE;
    expect(isRewriteTo404(await hit("/privacy"))).toBe(false);
  });
});

describe("S74 structure", () => {
  it("only the app-mode allow-list names /auth/callback, never the waitlist one", () => {
    const p = read("src/proxy.ts");
    expect(p.match(/const WAITLIST_PATHS = [^\n]*/)![0]).not.toContain("auth");
    expect(p.match(/const APP_PUBLIC = [^\n]*/)![0]).toContain("/auth/callback");
  });
  it("both OAuth routes use the app scope (404 in waitlist mode)", () => {
    for (const f of ["src/app/auth/callback/route.ts", "src/app/api/auth/oauth/google/route.ts"]) {
      const t = read(f);
      expect(t, f).toMatch(/openRoute\(/);
      expect(t, f).not.toMatch(/scope:/);
    }
  });
  it("the admin guard requires the password method; Google sign-in asks only for basic scopes and sign-up stays off", () => {
    expect(read("src/server/auth/admin.ts")).toMatch(/includes\("password"\)/);
    const start = read("src/app/api/auth/oauth/google/route.ts");
    expect(start).toContain('scopes: "openid email profile"');
    expect(start).toContain("skipBrowserRedirect: true");
    expect(read("supabase/config.toml")).toMatch(/enable_signup = false/);
  });
  it("the OAuth code never logs tokens or profile data", () => {
    for (const f of ["src/server/auth/oauth.ts", "src/server/auth/oauth-session.ts", "src/app/auth/callback/route.ts", "src/app/api/auth/oauth/google/route.ts"]) {
      expect(read(f), f).not.toMatch(/console\.|access_token|refresh_token|provider_token|user_metadata|identity_data/);
    }
  });
  it("redirectTo has no query and the destination comes from the cookie, not the callback URL", () => {
    expect(read("src/server/auth/oauth.ts")).toMatch(/oauthRedirectTo = \(origin: string\) => `\$\{origin\}\/auth\/callback`;/);
    const session = read("src/server/auth/oauth-session.ts");
    expect(session).not.toMatch(/q\.get\("next"\)|searchParams\.get\("next"\)/);
    expect(session).toContain("OAUTH_NEXT_COOKIE");
    expect(session.match(/clearOauthNextCookie\(\)/g)!.length).toBeGreaterThanOrEqual(2); // success path and the unexpected-failure path
  });
  it("the probe script checks the callback", () => {
    expect(read("scripts/probe-site.ts")).toContain('"/auth/callback"');
  });
});
