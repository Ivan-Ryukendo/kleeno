import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Convenience only (rule 33, S15): refreshes the Supabase session cookies and sends signed-out visitors to /login.
// It is NOT authorization: every page and route handler authenticates on its own.
// (Not a `server-only` module: proxy runs in its own bundle and reads only the two public Supabase values.)
const PUBLIC = ["/", "/login", "/privacy"];
const isPublic = (path: string) => PUBLIC.includes(path) || path.startsWith("/receipt/") || path.startsWith("/api/");

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach((c) => request.cookies.set(c.name, c.value));
        response = NextResponse.next({ request });
        list.forEach((c) => response.cookies.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }));
      },
    },
  });
  const { data } = await supabase.auth.getUser(); // refreshes an expiring session
  if (!data.user && !isPublic(request.nextUrl.pathname)) return NextResponse.redirect(new URL("/login", request.url));
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"] };
