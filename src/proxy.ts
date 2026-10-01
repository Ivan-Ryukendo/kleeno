import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every request (except Next's static chunks and image optimiser). Two jobs:
// 1. Site lockdown (docs/phases/W.md). Unless SITE_MODE=app, only an exact allowlist exists (landing page, /privacy,
//    the waitlist API, SEO files); everything else gets the same 404 as a page that never existed. Pages and route
//    handlers check the mode again themselves, so a proxy bypass still shows nothing.
// 2. Convenience only (rule 33, S15): refresh Supabase session cookies and send signed-out visitors to /login.
//    It is NOT authorization: every page and route handler authenticates on its own.
// (Not a `server-only` module: proxy runs in its own bundle and reads only public values plus SITE_MODE and ADMIN_PATH.)

const GATE = "x-kleeno-admin-gate"; // same name as ADMIN_GATE_HEADER in src/server/site.ts
const WAITLIST_PATHS = new Set(["/", "/privacy", "/api/waitlist", "/api/waitlist/survey", "/robots.txt", "/sitemap.xml", "/icon.svg", "/favicon.ico"]);
const WAITLIST_PREFIXES = ["/_next/", "/_vercel/", "/opengraph-image"];
const APP_PUBLIC = ["/", "/login", "/privacy"];
const isAppPublic = (path: string) => APP_PUBLIC.includes(path) || path.startsWith("/receipt/") || path.startsWith("/api/");

const adminPath = () => {
  const p = process.env.ADMIN_PATH ?? "";
  return /^[a-z0-9]{24,64}$/.test(p) ? p : null;
};

function notFound(request: NextRequest, path: string) {
  if (path.startsWith("/api/")) return NextResponse.json({ error: { code: "NOT_FOUND", message: "not found" } }, { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = "/kleeno-not-found"; // matches no route, so Next renders app/not-found.tsx with a 404 status
  url.search = "";
  return NextResponse.rewrite(url);
}

async function withSession(request: NextRequest, headers: Headers, make: (h: Headers) => NextResponse) {
  let response = make(headers);
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach((c) => request.cookies.set(c.name, c.value));
        const next = new Headers(headers);
        next.set("cookie", request.cookies.toString());
        response = make(next);
        list.forEach((c) => response.cookies.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }));
      },
    },
  });
  const { data } = await supabase.auth.getUser(); // refreshes an expiring session
  return { response, signedIn: !!data.user };
}

export async function proxy(request: NextRequest) {
  const raw = request.nextUrl.pathname;
  let path: string;
  try {
    path = decodeURIComponent(raw); // "/%61dmin" must be judged as "/admin"
  } catch {
    return notFound(request, raw);
  }
  if (/\.\.|\/\/|\\/.test(path)) return notFound(request, path); // encoded traversal or doubled slashes: never a real page
  const headers = new Headers(request.headers);
  headers.delete(GATE); // only this proxy may set the admin gate

  // Secret admin area: /<ADMIN_PATH>/... -> /admin/... and /<ADMIN_PATH>/api/... -> /api/admin/...
  const secret = adminPath();
  if (secret && (path === `/${secret}` || path.startsWith(`/${secret}/`))) {
    const rest = path.slice(secret.length + 1);
    const url = request.nextUrl.clone();
    url.pathname = rest.startsWith("/api/") ? `/api/admin${rest.slice(4)}` : `/admin${rest}`;
    headers.set(GATE, secret);
    const { response } = await withSession(request, headers, (h) => NextResponse.rewrite(url, { request: { headers: h } }));
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "no-referrer"); // the secret path never leaks through the Referer header
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  // The internal admin routes exist only behind the secret path.
  const lower = path.toLowerCase();
  if (lower === "/admin" || lower.startsWith("/admin/") || lower.startsWith("/api/admin")) return notFound(request, path);

  if (process.env.SITE_MODE !== "app") {
    if (WAITLIST_PATHS.has(path) || WAITLIST_PREFIXES.some((p) => path.startsWith(p))) return NextResponse.next({ request: { headers } });
    return notFound(request, path);
  }

  const { response, signedIn } = await withSession(request, headers, (h) => NextResponse.next({ request: { headers: h } }));
  if (!signedIn && !isAppPublic(path)) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
