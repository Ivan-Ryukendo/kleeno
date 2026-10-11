// Authored isolated acceptance. Never run against the remote development .env.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, expect, it } from "vitest";
import { ADDR, activeConfig, admin, approvedRun, makeCompany, userClient, type TestCompany, type TestUser } from "./helpers";

let company: TestCompany, other: TestCompany, viewer: TestUser;
const raw = ["workers", "calculation_lines", "obligations", "payment_batches", "payment_attempts", "company_wallets"];
const metadata = ["worker_directory", "calculation_line_metadata", "obligation_metadata", "payment_batch_metadata"];
beforeAll(async () => {
  company = await makeCompany({ live: true }); other = await makeCompany();
  const run = await approvedRun(company, await activeConfig(company));
  expect((await admin.from("company_wallets").insert({ company_id: company.id, role: "APPROVER", circle_wallet_id: "synthetic-wallet", address: ADDR(17), blockchain: "ARC-TESTNET" })).error).toBeNull();
  expect((await admin.from("payment_attempts").insert({ company_id: company.id, obligation_id: run.obligationId, idempotency_key: randomUUID(), state: "SUBMISSION_PENDING", circle_tx_id: `synthetic-transaction-${randomUUID()}` })).error).toBeNull();
  const email = `financial-read-${randomUUID()}@example.com`, password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("synthetic viewer creation failed");
  viewer = { id: created.data.user.id, companyId: company.id, email, password, roles: ["VIEWER"] };
  expect((await admin.from("memberships").insert({ company_id: company.id, user_id: viewer.id, email, roles: viewer.roles })).error).toBeNull();
});

it("VIEWER sees safe own-company directory/line metadata but no raw financial records", async () => {
  const client = await userClient(viewer);
  for (const table of raw) { const result = await client.from(table).select("*"); expect(result.error, table).toBeNull(); expect(result.data, table).toEqual([]); }
  for (const table of metadata) { const result = await client.from(table).select("*"); expect(result.error, table).toBeNull(); expect(result.data?.every(row => row.company_id === company.id), table).toBe(true); }
  expect((await client.from("worker_directory").select("id")).data?.length).toBeGreaterThan(0);
  expect((await client.from("calculation_line_metadata").select("id")).data?.length).toBeGreaterThan(0);
});
it("metadata views have no amount, recipient, wallet, plan or ciphertext columns", async () => {
  const client = await userClient(viewer);
  for (const [table, columns] of [["worker_directory", "wallet_address,metadata_enc"], ["calculation_line_metadata", "net,gross_enc,trace_enc"], ["obligation_metadata", "amount,recipient,tx_hash"], ["payment_batch_metadata", "plan"]]) expect((await client.from(table).select(columns)).error, table).not.toBeNull();
});
it("finance roles retain raw reads; OWNER-only loses them without losing safe metadata", async () => {
  const financial = await userClient(company.payroll);
  expect((await financial.from("calculation_lines").select("net")).data?.length).toBeGreaterThan(0);
  expect((await financial.from("workers").select("wallet_address")).data?.length).toBeGreaterThan(0);
  for (const table of ["payment_attempts", "company_wallets"]) {
    const result = await financial.from(table).select("*");
    expect(result.error, table).toBeNull();
    expect(result.data?.length, table).toBeGreaterThan(0);
  }
  expect((await admin.from("memberships").update({ roles: ["OWNER"] }).eq("company_id", company.id).eq("user_id", company.payroll.id)).error).toBeNull();
  const owner = await userClient(company.payroll);
  for (const table of raw) expect((await owner.from(table).select("*")).data, table).toEqual([]);
  expect((await owner.from("worker_directory").select("id")).data?.length).toBeGreaterThan(0);
  const payment = await userClient(company.payment);
  expect((await payment.from("calculation_lines").select("net")).data?.length).toBeGreaterThan(0);
});
it("Gateway recovery material is service-only even for finance roles", async () => {
  for (const user of [viewer, company.payroll, company.payment]) {
    const client = await userClient(user);
    expect((await client.from("gateway_transfers").select("*")).error).not.toBeNull();
    expect((await client.from("gateway_transfers").insert({ company_id: company.id })).error).not.toBeNull();
  }
  expect((await admin.from("gateway_transfers").select("id").eq("company_id", company.id)).error).toBeNull();
});
it("fixed views preserve tenant/MFA/revocation isolation and expose no public writes", async () => {
  const client = await userClient(viewer), foreign = await userClient(other.payroll);
  for (const table of raw) {
    const result = await foreign.from(table).select("*").eq("company_id", company.id);
    expect(result.error, table).toBeNull();
    expect(result.data, table).toEqual([]);
  }
  for (const table of metadata) {
    expect((await foreign.from(table).select("*").eq("company_id", company.id)).data, table).toEqual([]);
    expect((await client.from(table).delete().eq("company_id", company.id)).error, table).not.toBeNull();
  }
  expect((await admin.from("memberships").update({ removed_at: new Date().toISOString() }).eq("company_id", company.id).eq("user_id", viewer.id)).error).toBeNull();
  for (const table of metadata) expect((await client.from(table).select("*")).data, table).toEqual([]);
  expect((await admin.from("companies").update({ mfa_required: true }).eq("id", company.id)).error).toBeNull();
  const lowAssurance = await userClient(company.payment);
  for (const table of [...metadata, ...raw]) expect((await lowAssurance.from(table).select("*")).data, table).toEqual([]);
  const anon = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  for (const table of metadata) expect((await anon.from(table).select("*")).error, table).not.toBeNull();
  expect((await anon.from("gateway_transfers").select("*")).error).not.toBeNull();
  expect((await anon.from("gateway_transfers").insert({ company_id: company.id })).error).not.toBeNull();
});
