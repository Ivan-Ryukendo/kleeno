import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { SupportPanel } from "@/components/support-panel";
import { ReviewHelp } from "@/components/review-help";
import type { SupportTicketMeta } from "@/core/support";
import { pageSession } from "@/server/auth/page-session";
import { listSupport } from "@/server/db/support";
import { uuid } from "@/server/schemas";

export const metadata = { title: "Help · Kleeno" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  await connection();
  const { actor, companies } = await pageSession();
  const company = companies.find(c => c.companyId === actor.companyId);
  const { ticket } = await searchParams;
  let tickets: SupportTicketMeta[] = [], error: string | null = null;
  let hasMore = false;
  try { ({ tickets, hasMore } = await listSupport(actor)); }
  catch { error = "Support requests could not be loaded. Retry to check your current access."; }
  const validTicket = ticket && uuid.safeParse(ticket).success ? ticket : null;
  if (ticket && !validTicket) error = "The requested support link is invalid.";
  return <>
    <PageHeader title="Help and support" description={company?.name ?? "Current company"} />
    <ReviewHelp />
    <p className="mt-3 text-sm text-muted-foreground">Your requests in this company. Share only the message and evidence references you deliberately want platform support to inspect.</p>
    <SupportPanel key={`${actor.companyId}:${actor.userId}`} mode="requester" apiBase="/api/support" initialTickets={tickets} initialHasMore={hasMore} initialTicketId={validTicket} initialError={error} currentUserId={actor.userId} />
  </>;
}
