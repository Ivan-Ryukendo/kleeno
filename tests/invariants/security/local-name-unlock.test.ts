// Protected S42/rule 35 boundary: local worker names and name keys must remain in the browser.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const source = readFileSync(path.join(root, "src/components/local-name-unlock.tsx"), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("LocalNameUnlock keeps names and key material local", () => {
  it("is a client component with no network calls", () => {
    expect(source.trimStart()).toMatch(/^"use client";/);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|postJson|\bimport\s*\(/);
  });

  it("does not persist values, write URLs, or log local names", () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\b|document\.cookie|cookieStore/);
    expect(code).not.toMatch(/history\.(push|replace)State|location\.(href|search|hash|assign|replace)|router\.|useSearchParams|URLSearchParams/);
    expect(code).not.toMatch(/\bconsole\./);
  });

  it("imports no server or database code", () => {
    const imports = [...code.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier, specifier).not.toMatch(/^@\/server|server-only|^next\/(headers|server)|@supabase|^@\/app/);
  });
});
