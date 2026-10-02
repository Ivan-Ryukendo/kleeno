import "server-only";
import { env } from "@/server/env";

// Invite email through Resend (optional: without RESEND_API_KEY the sender copies the link). The message carries only the link,
// the company name and the inviter's role (S62). It never throws and never logs the address: false means "not sent".
export const emailEnabled = () => !!env.RESEND_API_KEY && !!env.EMAIL_FROM;

export async function sendInviteEmail(to: string, link: string, companyName: string, inviter: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject: `You are invited to ${companyName} on Kleeno`,
        text: `${inviter} invited you to join ${companyName} on Kleeno.\n\nOpen this link to accept (valid for 7 days, works once, only for this email address):\n${link}\n\nIf you did not expect this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
