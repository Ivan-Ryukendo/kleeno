import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { newCorrelationId } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { ViewError } from "@/core/views";
import { hasRole, type Role } from "@/core/tenancy";
import { WorkflowError } from "@/core/workflow";
import { logError } from "@/server/log";
import { adminGateOk, siteMode } from "@/server/site";
import { authenticateAdmin, type AdminActor } from "./admin";
import { AuthError, authenticate, authenticateUser, jarFromRequest, type Actor, type CookieJar, type Membership, type PendingCookie } from "./session";

// Every route handler goes through `guarded` (authenticated) or `openRoute` (login only; allowlisted by the S15 test).
// Steps: correlation ID -> Origin check on mutations (S17) -> session -> company + roles from memberships -> strict body (S14) -> handler.
export interface Handled<B, P> {
  actor: Actor; // company routes only
  user: { userId: string; companies: Membership[] }; // `noCompany` routes only (company chooser and switch)
  admin: AdminActor; // scope "admin" only
  client: SupabaseClient; // user-scoped: reads run under RLS
  body: B;
  params: P;
  request: Request;
  correlationId: string;
  jar: CookieJar;
  cookies: PendingCookie[]; // session cookies the handler wants set on the response
}

type RouteCtx<P> = { params: Promise<P> };
interface Options<B> {
  roles?: readonly Role[]; // the member needs at least one of these
  noCompany?: boolean; // signed in, no company chosen yet: only the company chooser and switch routes
  body?: z.ZodType<B>; // use .strict() so unknown fields (company_id, role, amount, state...) are rejected
  allowAal1?: boolean; // account routes a half-signed-in (password only) user needs: MFA verify/enrol, logout
  // "app" (default): the payroll app; 404 while SITE_MODE is waitlist. "waitlist": the public sign-up routes.
  // "admin": reachable only through the secret admin path (proxy gate header); a session means a platform admin (S52).
  scope?: "app" | "waitlist" | "admin";
  serverToServer?: boolean; // callbacks that carry their own signature (Circle webhook): no browser Origin to check
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function originOk(request: Request) {
  if (SAFE.has(request.method)) return true;
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(request.url).origin;
}

function fail(status: number, code: string, message: string, correlationId: string) {
  return NextResponse.json({ error: { code, message }, correlationId }, { status, headers: { "x-correlation-id": correlationId } });
}

function toResponse(err: unknown, correlationId: string) {
  if (err instanceof AuthError) return fail(err.status, err.code, err.message, correlationId);
  if (err instanceof z.ZodError) return fail(400, "BAD_REQUEST", `invalid request: ${[...new Set(err.issues.map((i) => i.path.join(".") || "body"))].join(", ")}`, correlationId);
  if (err instanceof ViewError) return fail(400, "BAD_REQUEST", err.message, correlationId);
  if (err instanceof TransitionError) return fail(err.code === "NOT_FOUND" ? 404 : 409, err.code, err.message, correlationId);
  if (err instanceof WorkflowError) return fail(err.code === "FORBIDDEN" ? 403 : 409, err.code, err.message, correlationId);
  if (err instanceof Error && /(23505)/.test(err.message)) return fail(409, "CONFLICT", "that already exists", correlationId);
  logError("route", correlationId, err); // never the raw error text: SDK errors can carry secrets (S45)
  return fail(500, "INTERNAL", "something went wrong; quote the support code", correlationId);
}

function wrap<B, P>(opts: Options<B>, authenticated: boolean, fn: (h: Handled<B, P>) => Promise<unknown>) {
  return async (request: Request, ctx?: RouteCtx<P>): Promise<Response> => {
    const correlationId = newCorrelationId();
    try {
      const scope = opts.scope ?? "app";
      if ((scope === "app" && siteMode() === "waitlist") || (scope === "admin" && !adminGateOk(request.headers))) return fail(404, "NOT_FOUND", "not found", correlationId);
      if (!opts.serverToServer && !originOk(request)) throw new AuthError(403, "FORBIDDEN", "cross-origin request refused");
      const jar = jarFromRequest(request);
      const cookies: PendingCookie[] = [];
      const asAdmin = authenticated && scope === "admin" ? await authenticateAdmin(jar, { allowAal1: opts.allowAal1, sink: cookies }) : null;
      const bare = authenticated && !asAdmin && opts.noCompany ? await authenticateUser(jar, { sink: cookies }) : null;
      if (bare && bare.nextLevel === "aal2" && bare.aal !== "aal2") throw new AuthError(401, "MFA_REQUIRED", "multi-factor sign-in required");
      const auth = authenticated && !asAdmin && !bare ? await authenticate(jar, { allowAal1: opts.allowAal1, sink: cookies }) : null;
      if (auth && opts.roles && !hasRole(auth.actor.roles, ...opts.roles)) throw new AuthError(403, "FORBIDDEN", "your role cannot do this");
      const raw = opts.body ? await request.text() : "";
      if (scope !== "app" && raw.length > 8192) return fail(413, "TOO_LARGE", "request too large", correlationId); // public + admin bodies are small (S53)
      const body = (opts.body ? opts.body.parse(parseJson(raw)) : undefined) as B;
      const params = (ctx ? await ctx.params : {}) as P;
      const result = await fn({ actor: auth?.actor as Actor, user: bare as Handled<B, P>["user"], admin: asAdmin?.admin as AdminActor, client: (auth ?? bare ?? asAdmin)?.client as SupabaseClient, body, params, request, correlationId, jar, cookies });
      const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      res.headers.set("x-correlation-id", correlationId);
      for (const c of cookies) (res as NextResponse).cookies?.set(c.name, c.value, { ...c.options, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
      return res;
    } catch (err) {
      return toResponse(err, correlationId);
    }
  };
}

export const guarded = <B = undefined, P = Record<string, string>>(opts: Options<B>, fn: (h: Handled<B, P>) => Promise<unknown>) => wrap<B, P>(opts, true, fn);
export const openRoute = <B = undefined>(opts: Pick<Options<B>, "body" | "scope" | "serverToServer">, fn: (h: Handled<B, Record<string, string>>) => Promise<unknown>) => wrap<B, Record<string, string>>(opts, false, fn);
