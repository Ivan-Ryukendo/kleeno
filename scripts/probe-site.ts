// Lockdown probe for a waitlist-mode site (docs/phases/W.md, named check 4; docs/phases/W-launch.md).
//   npm run script -- scripts/probe-site.ts https://kleeno.orclide.com [--admin-var PROD_ADMIN_PATH] [--delay-ms 1500] [--skip-edge-blocked]
// Public pages must answer 200, every other guessed URL 404 (after redirects). With --admin-var, the admin path is read
// from that env variable (never printed) and must land on the login page with noindex + no-store.
import { fail } from "./_lib";

const base = process.argv[2]?.replace(/\/$/, "");
if (!base || !/^https?:\/\//.test(base)) fail("usage: scripts/probe-site.ts <https://site> [--admin-var NAME]");
const varAt = process.argv.indexOf("--admin-var");
const adminVar = varAt > 0 ? process.argv[varAt + 1] : undefined;
// Against a live Vercel site, pause between requests: a fast burst of scanner-style URLs trips its bot challenge (403).
const delayAt = process.argv.indexOf("--delay-ms");
const delayMs = delayAt > 0 ? Number(process.argv[delayAt + 1]) || 0 : 0;
// Classic scanner URLs that Vercel's own edge blocks (403/400) before the app sees them; they are checked on a local build.
const EDGE_BLOCKED = new Set(["/login.php", "/wp-admin", "/server-status", "/%2e%2e/%2e%2e/etc/passwd", "/..%2fdashboard"]);
const skipEdge = process.argv.includes("--skip-edge-blocked");
const pause = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : undefined);

const PUBLIC = ["/", "/privacy", "/robots.txt", "/sitemap.xml", "/icon.svg", "/opengraph-image"];
const LOCKED = [
  "/dashboard", "/login", "/account", "/workers", "/runs/abc", "/runs/abc.png",
  "/admin", "/Admin", "/ADMIN/login", "/admin/login", "/%61dmin", "/admin%2Flogin", "/admin/contacts/x",
  "/api/admin/login", "/api/admin/export", "/api/auth/login", "/api/workers", "/api/runs", "/api/runs/x/approve",
  "/dashboard.json", "/login.php", "/index.html", "/page", "/(app)/dashboard", "/kleeno-not-found",
  "/.env", "/.env.local", "/.git/config", "/package.json", "/next.config.ts", "/src/proxy.ts",
  "/%2e%2e/%2e%2e/etc/passwd", "/..%2fdashboard", "/privacy/../dashboard", "/_next/../dashboard", "/wp-admin", "/server-status",
];

let failures = 0;
async function check(path: string, want: number, label = path) {
  await pause();
  const res = await fetch(base + path, { redirect: "follow" });
  const ok = res.status === want;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${res.status} ${label}`);
  return res;
}

async function main() {
  for (const p of PUBLIC) await check(p, 200);
  for (const p of LOCKED) if (!(skipEdge && EDGE_BLOCKED.has(p))) await check(p, 404);
  // The waitlist API must exist but refuse a GET (it only takes POST).
  const api = await fetch(`${base}/api/waitlist`);
  console.log(`${api.status === 405 ? "ok  " : "FAIL"} ${api.status} GET /api/waitlist (want 405)`);
  if (api.status !== 405) failures++;

  if (adminVar) {
    const path = process.env[adminVar];
    if (!path) fail(`${adminVar} is not set in .env`);
    const res = await check(`/${path}`, 200, "/<admin path> -> login");
    const headersOk = /noindex/.test(res.headers.get("x-robots-tag") ?? "") && /no-store/.test(res.headers.get("cache-control") ?? "");
    const atLogin = new URL(res.url).pathname === `/${path}/login`;
    console.log(`${headersOk && atLogin ? "ok  " : "FAIL"} admin login reached with noindex + no-store`);
    if (!(headersOk && atLogin)) failures++;
  }

  console.log(failures ? `${failures} check(s) failed` : "all checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => fail(`probe failed: ${e instanceof Error ? e.message : "unknown error"}`));
