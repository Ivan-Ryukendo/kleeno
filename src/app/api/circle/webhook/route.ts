import { NextResponse } from "next/server";
import { z } from "zod";
import { openRoute } from "@/server/auth/guard";
import { verifyCircleSignature } from "@/server/circle/webhook";
import { onCircleNotification } from "@/server/payments/execute";

// Circle webhook (S27). Public, but only a body Circle signed gets past the first check. The payload is a hint: the handler re-queries
// Circle and Arc for the one obligation it names and never reads an amount, recipient or state from it.
const MAX_BODY = 16_384;
const Payload = z.object({ notificationId: z.string().min(1).max(100), notificationType: z.string().max(100), notification: z.object({ id: z.string().min(1).max(100) }) });

const reply = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

export const POST = openRoute({ serverToServer: true }, async ({ request, correlationId }) => {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return reply(413, "TOO_LARGE", "request too large");
  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply(413, "TOO_LARGE", "request too large");
  const signature = request.headers.get("x-circle-signature");
  const keyId = request.headers.get("x-circle-key-id");
  if (!signature || !keyId || !(await verifyCircleSignature(raw, signature, keyId))) return reply(401, "UNAUTHENTICATED", "invalid signature");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply(400, "BAD_REQUEST", "invalid body");
  }
  const p = Payload.safeParse(json);
  if (!p.success || !p.data.notificationType.startsWith("transactions.")) return { ok: true }; // test pings and other event types: nothing to do
  await onCircleNotification({ notificationId: p.data.notificationId, circleTxId: p.data.notification.id }, { correlationId });
  return { ok: true };
});
