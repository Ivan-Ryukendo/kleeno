import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatUsdc } from "@/core/money";
import { EXPLORER_TX } from "@/server/arc/reader";
import { allow, keyFromHeaders } from "@/server/db/growth";
import { receiptByToken } from "@/server/db/receipts";
import { siteMode } from "@/server/site";

export const metadata = { title: "Payment receipt · Kleeno", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

// Public receipt for one payment (S36). Outside the app shell and the (app) layout, so it checks the site lockdown itself:
// in waitlist mode it is a 404 like every other payroll page. It shows only the net amount, the status and the on-chain proof.
// A bad, forged, expired or unknown link, and a rate-limited visitor, all see the same calm message.
export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  if (siteMode() === "waitlist") notFound();
  const { token } = await params;
  const limited = !(await allow("receipt", keyFromHeaders(await headers()), 600, 60));
  const receipt = limited ? null : await receiptByToken(token);

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-sm font-bold uppercase tracking-[0.04em]">
        <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
        Payment receipt
      </p>
      {receipt ? (
        <>
          <h1 className="mt-4 text-5xl">{formatUsdc(receipt.amount)} USDC</h1>
          <div className="mt-8 rounded-[2.5rem] bg-card p-8 shadow-card sm:p-10">
            <dl className="space-y-5">
              <div>
                <dt className="text-sm text-muted-foreground">Status</dt>
                <dd className="text-lg font-medium">{receipt.status === "SETTLED" ? "Settled" : "Not settled"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Network</dt>
                <dd className="text-lg font-medium">Arc testnet</dd>
              </div>
              {receipt.txHash && (
                <div>
                  <dt className="text-sm text-muted-foreground">Transaction</dt>
                  <dd className="break-all font-mono text-sm">{receipt.txHash}</dd>
                  <dd className="mt-3">
                    <a className="underline underline-offset-4" href={EXPLORER_TX(receipt.txHash)} target="_blank" rel="noreferrer noopener">
                      View on arcscan
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">This is a test-network payment. The link shows the net amount only and expires 30 days after it was created.</p>
        </>
      ) : (
        <>
          <h1 className="mt-4 text-5xl">Link not valid</h1>
          <div className="mt-8 rounded-[2.5rem] bg-card p-8 shadow-card sm:p-10">
            <p className="text-muted-foreground">This receipt link is not valid or has expired. Ask the company that paid you for a new one.</p>
          </div>
        </>
      )}
    </main>
  );
}
