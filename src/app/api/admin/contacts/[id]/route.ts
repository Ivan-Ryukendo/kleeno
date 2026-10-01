import { NextResponse } from "next/server";
import { z } from "zod";
import { LEAD_ACTIONS, type LeadAction } from "@/core/growth";
import { guarded } from "@/server/auth/guard";
import { applyLeadAction, deleteContact, updateContact } from "@/server/db/growth";

const leadActions = Object.keys(LEAD_ACTIONS) as [LeadAction, ...LeadAction[]];
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(leadActions) }).strict(),
  z
    .object({
      action: z.literal("SAVE"),
      notes: z.string().trim().max(5000).nullable(),
      nextActionAt: z.iso.date().nullable(),
      isTest: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("DELETE"), confirm: z.literal("DELETE") }).strict(),
]);

const notFound = () => NextResponse.json({ error: { code: "NOT_FOUND", message: "contact not found" } }, { status: 404 });

// Admin changes to one contact (S52): named actions only; every status change is recorded in growth.contact_events.
export const POST = guarded<z.infer<typeof Body>, { id: string }>({ scope: "admin", body: Body }, async ({ admin, body, params }) => {
  if (!z.uuid().safeParse(params.id).success) return notFound();
  if (body.action === "DELETE") return (await deleteContact(params.id, admin.userId)) ? { ok: true } : notFound();
  if (body.action === "SAVE")
    return (await updateContact(params.id, { notes: body.notes || null, nextActionAt: body.nextActionAt, isTest: body.isTest })) ? { ok: true } : notFound();
  if (await applyLeadAction(params.id, body.action, admin.userId)) return { ok: true };
  return NextResponse.json({ error: { code: "CONFLICT", message: "the contact changed or was deleted; reload the page" } }, { status: 409 });
});
