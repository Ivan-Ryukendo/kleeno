import { notFound } from "next/navigation";
import { siteMode } from "@/server/site";

// Second wall of the site lockdown (docs/phases/W.md): while SITE_MODE is waitlist, no payroll page exists,
// even if a request got past src/proxy.ts. Changing SITE_MODE in Vercel needs a redeploy.
export default function PayrollAppLayout({ children }: { children: React.ReactNode }) {
  if (siteMode() === "waitlist") notFound();
  return children;
}
