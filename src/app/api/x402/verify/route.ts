import { openRoute } from "@/server/auth/guard";
import { liveDeps } from "@/server/x402/live";
import { handleVerify } from "@/server/x402/verify";

// Kleeno Verify (S68): public and paid. No session; the price, a rate limit and an unguessable target are the access control.
// GET only and read-only: it never writes payroll data (its only write is the x402 payment ledger row).
export const GET = openRoute({}, ({ request }) => handleVerify(request, liveDeps()));
