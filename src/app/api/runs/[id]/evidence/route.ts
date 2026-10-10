import { guarded } from "@/server/auth/guard";
import { downloadEvidencePack } from "@/server/db/evidence-pack";
import { uuid } from "@/server/schemas";

export const GET = guarded<undefined, { id: string }>({ roles: ["HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER"] }, async ({ actor, client, params }) => {
  const pack = await downloadEvidencePack(client, actor, uuid.parse(params.id));
  return new Response(new Uint8Array(pack.bytes), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${pack.filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Content-SHA256": pack.byteHash } });
});
