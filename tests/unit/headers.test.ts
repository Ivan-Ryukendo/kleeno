// S36 (headers) and S40 (transport). Reads the real next.config.ts.
import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";
import nextConfig, { securityHeaders } from "../../next.config";

const header = (k: string) => securityHeaders.find((h) => h.key === k)?.value ?? "";

describe("S36 security headers", () => {
  it("CSP forbids framing, plugins and foreign form posts", () => {
    const csp = header("Content-Security-Policy");
    for (const d of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(d);
  });
  it("nosniff, referrer and permissions policies are set", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=()");
  });
  it("applies to every path; the receipt path sends no Referer and is not indexed", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.find((r) => r.source === "/:path*")?.headers).toEqual(securityHeaders);
    const receipt = rules.find((r) => r.source.startsWith("/receipt"))!;
    expect(receipt.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });
});

describe("S40 transport", () => {
  it("HSTS is two years with subdomains", () => {
    expect(header("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
  });
  it("server code never calls a service over plain http (localhost aside)", () => {
    const offenders = globSync("src/server/**/*.ts").filter((f) => /["'`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
