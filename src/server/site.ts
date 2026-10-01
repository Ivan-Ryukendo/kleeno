import "server-only";
import { timingSafeEqual } from "node:crypto";

// Site lockdown (docs/phases/W.md). Read per call so tests can switch modes; changing it in Vercel needs a redeploy.
// Anything but SITE_MODE=app means waitlist mode: only the landing page, /privacy, the waitlist API and the secret admin path exist.
export const siteMode = (): "app" | "waitlist" => (process.env.SITE_MODE === "app" ? "app" : "waitlist");

// The admin area lives at /<ADMIN_PATH> (Vercel env, never in the repo). Unset or malformed = no admin area at all.
// The proxy rewrites /<ADMIN_PATH>/... to /admin/... and sets this header; pages and routes refuse requests without it,
// so /admin itself (or a proxy bypass) shows nothing. Keep the name in sync with src/proxy.ts.
export const ADMIN_GATE_HEADER = "x-kleeno-admin-gate";
const ADMIN_PATH_PATTERN = /^[a-z0-9]{24,64}$/;

export const adminPath = () => {
  const p = process.env.ADMIN_PATH ?? "";
  return ADMIN_PATH_PATTERN.test(p) ? p : null;
};

export function adminGateOk(headers: Headers): boolean {
  const expected = adminPath();
  const got = headers.get(ADMIN_GATE_HEADER) ?? "";
  return !!expected && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
