import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BUDGET_LABELS, PAIN_LABELS, ROLE_LABELS, SIZE_LABELS, STATUS_LABELS } from "@/core/growth";
import { ContactActions } from "@/components/admin-forms";
import { adminPageSession } from "@/server/auth/admin";
import { getContact } from "@/server/db/growth";

const label = (map: Record<string, string>, v: string | null | undefined) => (v ? (map[v] ?? v) : "–");
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { base } = await adminPageSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await getContact(id);
  if (!c) notFound();

  const facts: [string, string][] = [
    ["Status", label(STATUS_LABELS, c.status)],
    ["Joined", when(c.created_at)],
    ["Role", label(ROLE_LABELS, c.role)],
    ["Company", c.company_name ?? "–"],
    ["Team size", label(SIZE_LABELS, c.company_size)],
    ["Source", [c.utm_source ?? c.source, c.utm_medium, c.utm_campaign].filter(Boolean).join(" · ") || "direct"],
    ["Consent", `${c.consent_version}, ${when(c.consented_at)}`],
  ];
  const answers: [string, string][] = [
    ["Biggest challenge", label(PAIN_LABELS, c.surveys?.pain_point)],
    ["Monthly budget (research)", label(BUDGET_LABELS, c.surveys?.budget_band)],
    ["Open to a call", c.surveys?.wants_call == null ? "–" : c.surveys.wants_call ? "Yes" : "No"],
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href={base} className="text-sm underline underline-offset-4">← All contacts</Link>
      <h1 className="mt-4 break-all text-4xl font-medium tracking-[-0.02em]">{c.email}</h1>
      {c.is_test && <p className="mt-2 text-sm">Test record: excluded from every metric.</p>}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[2.5rem] bg-card p-8">
          <h2 className="text-xl font-medium">Contact</h2>
          <dl className="mt-4 space-y-3">
            {facts.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-6 text-sm">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="rounded-[2.5rem] bg-card p-8">
          <h2 className="text-xl font-medium">Survey</h2>
          {c.surveys ? (
            <dl className="mt-4 space-y-3">
              {answers.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">Answered {when(c.surveys.completed_at)}</p>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Skipped the survey.</p>
          )}
        </section>
      </div>

      <div className="mt-10 rounded-[2.5rem] bg-card p-8">
        <ContactActions base={base} id={c.id} status={c.status} notes={c.notes} nextActionAt={c.next_action_at} isTest={c.is_test} />
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-medium">Status history</h2>
        {c.contact_events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {c.contact_events.map((e, i) => (
              <li key={i}>
                {when(e.created_at)}: {label(STATUS_LABELS, e.from_status)} → {label(STATUS_LABELS, e.to_status)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
