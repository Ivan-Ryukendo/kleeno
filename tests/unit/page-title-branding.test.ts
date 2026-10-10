import type { Metadata } from "next";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";
import { beforeEach, expect, it, vi } from "vitest";
import { metadata as rootMetadata } from "@/app/layout";
import * as AppLayout from "@/app/(app)/layout";
import { metadata as loginMetadata } from "@/app/(app)/(auth)/login/page";
import { metadata as receiptMetadata } from "@/app/receipt/[token]/page";

const state = vi.hoisted(() => ({ mode: "app" }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "synthetic-font" }) }));
vi.mock("@/server/env", () => ({ env: { SITE_URL: "http://127.0.0.1:3000" } }));
vi.mock("@/server/site", () => ({ siteMode: () => state.mode }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/server/arc/reader", () => ({ EXPLORER_TX: vi.fn() }));
vi.mock("@/server/db/growth", () => ({ allow: vi.fn(), keyFromHeaders: vi.fn() }));
vi.mock("@/server/db/receipts", () => ({ receiptByToken: vi.fn() }));
const appTitle = () => {
  const root = resolveTitle(rootMetadata.title, null);
  const group = (AppLayout as { metadata?: Metadata }).metadata;
  return group?.title ? resolveTitle(group.title, root.template) : root;
};
beforeEach(() => { state.mode = "app"; });

it("resolves actual login metadata to exactly one brand suffix", () => {
  expect(resolveTitle(loginMetadata.title, appTitle().template).absolute).toBe("Sign in · Kleeno");
});
it("preserves the exact root fallback and public title template", () => {
  const root = resolveTitle(rootMetadata.title, null);
  expect(appTitle().absolute).toBe(root.absolute);
  expect(resolveTitle("Privacy", root.template).absolute).toBe("Privacy · Kleeno");
  expect(resolveTitle("Admin", root.template).absolute).toBe("Admin · Kleeno");
});
it("resolves receipt title once and preserves its privacy metadata", () => {
  expect(resolveTitle(receiptMetadata.title, resolveTitle(rootMetadata.title, null).template).absolute).toBe("Payment receipt · Kleeno");
  expect(receiptMetadata.robots).toEqual({ index: false, follow: false });
  expect(receiptMetadata.referrer).toBe("no-referrer");
});
it("retains the app layout waitlist guard and allowed child rendering", () => {
  expect(AppLayout.default({ children: "existing content" })).toBe("existing content");
  state.mode = "waitlist";
  expect(() => AppLayout.default({ children: "existing content" })).toThrow("NOT_FOUND");
});
