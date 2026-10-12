import { NextResponse } from "next/server";
import { guarded } from "@/server/auth/guard";
import { previewUsageInvoice } from "@/server/db/billing-collection";
export const GET = guarded({ roles: ["OWNER"] }, async ({ actor, request, correlationId }) => NextResponse.json(await previewUsageInvoice({ companyId: actor.companyId, userId: actor.userId, correlationId }, new URL(request.url).searchParams.get("month") ?? "")));
