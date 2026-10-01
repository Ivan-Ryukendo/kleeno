import { BUDGET_LABELS, PAIN_LABELS, ROLE_LABELS, SIZE_LABELS, STATUS_LABELS, toCsv } from "@/core/growth";
import { guarded } from "@/server/auth/guard";
import { exportRows, logExport } from "@/server/db/growth";

const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? v) : "");
const yesNo = (v: boolean | null | undefined) => (v == null ? "" : v ? "yes" : "no");

// CSV of every contact (S56): admin only, formula-safe cells, never cached, recorded in growth.admin_events.
export const GET = guarded({ scope: "admin" }, async ({ admin }) => {
  const rows = await exportRows();
  const csv = toCsv(
    ["created_at", "email", "status", "role", "company", "company_size", "pain_point", "budget", "wants_call", "source", "utm_source", "utm_medium", "utm_campaign", "next_action", "notes", "is_test", "consent_version"],
    rows.map((c) => [
      c.created_at,
      c.email,
      label(STATUS_LABELS, c.status),
      label(ROLE_LABELS, c.role),
      c.company_name,
      label(SIZE_LABELS, c.company_size),
      label(PAIN_LABELS, c.surveys?.pain_point),
      label(BUDGET_LABELS, c.surveys?.budget_band),
      yesNo(c.surveys?.wants_call),
      c.source,
      c.utm_source,
      c.utm_medium,
      c.utm_campaign,
      c.next_action_at,
      c.notes,
      yesNo(c.is_test),
      c.consent_version,
    ]),
  );
  await logExport(admin.userId, rows.length);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kleeno-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
