// S74: the post-login destination is an allow-list of relative app paths (no open redirect); linked-method helpers.
import { describe, expect, it } from "vitest";
import { amrMethods, clearOauthNextCookie, HOME, linkedMethods, oauthNextCookie, oauthRedirectTo, safeNext } from "@/server/auth/oauth";

describe("safeNext", () => {
  it("keeps allow-listed relative app paths", () => {
    for (const p of ["/dashboard", "/workers", "/import", "/configuration", "/exceptions", "/settlement", "/account", "/select-company", "/onboarding", "/settings/team", "/settings/company", "/runs/0b8e2a1c-4f3d-4e0a-9d7b-1a2b3c4d5e6f"]) {
      expect(safeNext(p), p).toBe(p);
    }
  });

  it("sends everything else Home", () => {
    const bad = [
      "https://evil.example/dashboard",
      "http://evil.example",
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/%2f%2fevil.example",
      "%2f%2fevil.example",
      "/%2e%2e/admin",
      "/dashboard/../admin",
      "/dashboard?next=https://evil.example",
      "/dashboard#x",
      "/dashboard/",
      "/Dashboard",
      "/dashboard%00",
      "/dash\nboard",
      "javascript:alert(1)",
      "data:text/html,x",
      "dashboard",
      "/login",
      "/api/auth/logout",
      "/runs/",
      "/runs/a/b",
      "/runs/" + "a".repeat(65),
      "/admin",
      " /dashboard",
      "",
    ];
    for (const p of bad) expect(safeNext(p), JSON.stringify(p)).toBe(HOME);
    expect(safeNext(null)).toBe(HOME);
    expect(safeNext(undefined)).toBe(HOME);
    expect(safeNext("/dashboard" + "a".repeat(200))).toBe(HOME);
  });
});

describe("oauthRedirectTo and the next cookie", () => {
  it("redirectTo is exactly /auth/callback: no query, so the Supabase allow-list entry matches", () => {
    expect(oauthRedirectTo("https://kleeno.orclide.com")).toBe("https://kleeno.orclide.com/auth/callback");
    expect(oauthRedirectTo("http://localhost:3000")).toBe("http://localhost:3000/auth/callback");
  });
  it("the destination travels in a 10-minute cookie, already allow-listed", () => {
    expect(oauthNextCookie("/workers")).toEqual({ name: "kleeno-oauth-next", value: "/workers", options: { path: "/", maxAge: 600 } });
    expect(oauthNextCookie("//evil.example").value).toBe("/dashboard");
    expect(oauthNextCookie(undefined).value).toBe("/dashboard");
    expect(clearOauthNextCookie()).toMatchObject({ name: "kleeno-oauth-next", value: "", options: { maxAge: 0 } });
  });
});

describe("linkedMethods", () => {
  const id = (provider: string) => ({ provider }) as never;
  it("maps Supabase identities (email = password)", () => {
    expect(linkedMethods({ identities: [id("email")], app_metadata: {} })).toEqual(["password"]);
    expect(linkedMethods({ identities: [id("google"), id("email")], app_metadata: {} })).toEqual(["password", "google"]);
    expect(linkedMethods({ identities: [id("google")], app_metadata: {} })).toEqual(["google"]);
    expect(linkedMethods({ identities: [id("github")], app_metadata: {} })).toEqual([]);
  });
  it("falls back to app_metadata.providers when identities are absent", () => {
    expect(linkedMethods({ identities: undefined, app_metadata: { providers: ["email", "google"] } })).toEqual(["password", "google"]);
    expect(linkedMethods({ identities: undefined, app_metadata: {} })).toEqual([]);
  });
});

describe("amrMethods", () => {
  it("reads both claim shapes", () => {
    expect(amrMethods(["password", "totp"])).toEqual(["password", "totp"]);
    expect(amrMethods([{ method: "oauth" }, { method: "totp" }])).toEqual(["oauth", "totp"]);
    expect(amrMethods(undefined)).toEqual([]);
  });
});
