import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { newCorrelationId } from "@/core/audit";
import { TransitionError } from "@/core/domain/machines";
import { WorkflowError, type Role } from "@/core/workflow";
import { logError } from "@/server/log";
import { AuthError, authenticate, jarFromRequest, type Actor, type CookieJar, type PendingCookie } from "./session";

// Every route handler goes through `guarded` (authenticated) or `openRoute` (login only; allowlisted by the S15 test).
// Steps: correlation ID -> Origin check on mutations (S17) -> session -> role from app_users -> strict body (S14) -> handler.
export interface Handled<B, P> {
  actor: Actor;
  client: SupabaseClient; // user-scoped: reads run under RLS
  body: B;
  params: P;
  correlationId: string;
  jar: CookieJar;
  cookies: PendingCookie[]; // session cookies the handler wants set on the response
}

type RouteCtx<P> = { params: Promise<P> };
interface Options<B> {
  roles?: readonly Role[];
  body?: z.ZodType<B>; // use .strict() so unknown fields (company_id, role, amount, state...) are rejected
  allowAal1?: boolean; // account routes a half-signed-in (password only) user needs: MFA verify/enrol, logout
}

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
      if (!originOk(request)) throw new AuthError(403, "FORBIDDEN", "cross-origin request refused");
      const jar = jarFromRequest(request);
      const cookies: PendingCookie[] = [];
      const auth = authenticated ? await authenticate(jar, { allowAal1: opts.allowAal1, sink: cookies }) : null;
      if (auth && opts.roles && !opts.roles.includes(auth.actor.role)) throw new AuthError(403, "FORBIDDEN", "your role cannot do this");
      const body = (opts.body ? opts.body.parse(await request.json().catch(() => ({}))) : undefined) as B;
      const params = (ctx ? await ctx.params : {}) as P;
      const result = await fn({ actor: auth?.actor as Actor, client: auth?.client as SupabaseClient, body, params, correlationId, jar, cookies });
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
export const openRoute = <B = undefined>(opts: Pick<Options<B>, "body">, fn: (h: Handled<B, Record<string, string>>) => Promise<unknown>) => wrap<B, Record<string, string>>(opts, false, fn);
