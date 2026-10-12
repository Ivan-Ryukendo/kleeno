import Link from "next/link";
import { connection } from "next/server";
import { SupportPanel } from "@/components/support-panel";
import type { SupportTicketMeta } from "@/core/support";
import { adminPageSession } from "@/server/auth/admin";
import { listAdminSupport } from "@/server/db/support";
import { uuid } from "@/server/schemas";

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  await connection();
  const { admin, base } = await adminPageSession();
  const { ticket } = await searchParams;
  let tickets: SupportTicketMeta[] = [], error: string | null = null;
  let hasMore = false;
  try { ({ tickets, hasMore } = await listAdminSupport(admin)); }
  catch { error = "Support queue could not be loaded. Retry to check your current access."; }
  const validTicket = ticket && uuid.safeParse(ticket).success ? ticket : null;
  if (ticket && !validTicket) error = "The requested support link is invalid.";
  return <main className="mx-auto max-w-7xl px-6 py-12">
    <Link href={base} className="inline-flex min-h-11 items-center rounded-[1.25rem] text-sm underline underline-offset-4">Back to accounts and leads</Link>
    <h1 className="mt-3 text-4xl font-medium tracking-[-0.02em]">Support requests</h1>
    <p className="mt-3 max-w-2xl text-sm text-muted-foreground">Inspect deliberately submitted customer evidence. Customer-visible replies and internal staff notes have separate controls.</p>
    <SupportPanel mode="staff" apiBase={`${base}/api/support`} initialTickets={tickets} initialHasMore={hasMore} initialTicketId={validTicket} initialError={error} currentUserId={admin.userId} />
  </main>;
}
