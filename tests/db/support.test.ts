// Authored isolated DB acceptance; never run against a remote development or production project.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminSupportAction, createSupport, loadAdminSupport, loadSupport, supportAction } from "@/server/db/support";
import { admin, makeCompany, userClient } from "./helpers";

describe("encrypted self-only support acceptance", () => {
  it("atomically replays commands, rejects stale/conflicting keys and preserves private history", async () => {
    const company = await makeCompany();
    const requester = { companyId: company.id, userId: company.payment.id, correlationId: randomUUID() };
    const other = { companyId: company.id, userId: company.payroll.id, correlationId: randomUUID() };
    const command = { idempotencyKey: randomUUID(), category: "REVIEW" as const, severity: "NORMAL" as const, subject: "SUPPORT_SUBJECT_CANARY", body: "SUPPORT_BODY_CANARY", evidenceRefs: ["SUPPORT_REF_CANARY"] };
    const created = await createSupport(requester, command);
    expect(await createSupport(requester, command)).toEqual(created);
    await expect(createSupport(requester, { ...command, body: "Different payload" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(loadSupport(other, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stored = (await admin.from("support_events").select("id,payload_enc").eq("company_id", company.id).eq("request_id", created.id)).data!;
    expect(stored).toHaveLength(1); expect(JSON.stringify(stored)).not.toContain("CANARY");
    const u = await userClient(company.payment), peer = await userClient(company.payroll);
    expect((await peer.from("support_requests").select("id").eq("id", created.id)).data).toEqual([]);
    expect((await u.from("support_events").update({ payload_enc: "tamper" }).eq("request_id", created.id).select("id")).data ?? []).toEqual([]);
    expect((await admin.from("support_events").update({ payload_enc: "tamper" }).eq("id", stored[0].id)).error).not.toBeNull();
    expect((await u.rpc("append_support_event", { p_company: company.id, p_request: created.id, p_actor: requester.userId, p_admin: true, p_correlation: randomUUID(), p_command: {} })).error).not.toBeNull();

    const staff = await admin.auth.admin.createUser({ email: `support-${randomUUID()}@example.com`, password: randomUUID(), email_confirm: true });
    if (staff.error || !staff.data.user) throw new Error("support staff fixture failed");
    const allowlisted = await admin.schema("growth").from("platform_admins").insert({ user_id: staff.data.user.id });
    if (allowlisted.error) throw new Error("support staff allowlist failed");
    const actor = { userId: staff.data.user.id, correlationId: randomUUID() };
    const note = { action: "note" as const, expectedRevision: 1, idempotencyKey: randomUUID(), body: "SUPPORT_INTERNAL_CANARY", evidenceRefs: [] };
    expect(await adminSupportAction(actor, created.id, note)).toMatchObject({ revision: 2 });
    expect(await adminSupportAction(actor, created.id, note)).toMatchObject({ revision: 2 });
    await expect(supportAction(requester, created.id, { action: "close", expectedRevision: 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await loadSupport(requester, created.id)).messages).toHaveLength(1);
    expect((await loadAdminSupport(actor, created.id)).messages[1]).toMatchObject({ body: "SUPPORT_INTERNAL_CANARY", visibility: "INTERNAL" });
    expect((await u.from("support_events").select("visibility").eq("request_id", created.id)).data).toEqual([{ visibility: "CUSTOMER" }]);
    const audit = (await admin.from("audit_events").select("refs").eq("company_id", company.id).eq("entity_id", created.id)).data!;
    expect(JSON.stringify(audit)).not.toContain("CANARY");

    await supportAction(requester, created.id, { action: "close", expectedRevision: 2, idempotencyKey: randomUUID() });
    await supportAction(requester, created.id, { action: "reply", expectedRevision: 3, idempotencyKey: randomUUID(), body: "Reopen", evidenceRefs: [] });
    expect((await loadSupport(requester, created.id)).ticket).toMatchObject({ status: "OPEN", revision: 4 });
    expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", company.id).eq("user_id", requester.userId)).error).toBeNull();
    await expect(createSupport(requester, command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(loadSupport(requester, created.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await admin.schema("growth").from("platform_admins").delete().eq("user_id", actor.userId);
    await expect(adminSupportAction(actor, created.id, note)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
