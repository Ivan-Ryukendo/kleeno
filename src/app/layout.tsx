import type { Metadata } from "next";
import "./globals.css";
import { Sofia_Sans } from "next/font/google";
import { cn } from "@/lib/utils";
import { env } from "@/server/env";

const sofia = Sofia_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: { default: "Kleeno · AI payroll reconciliation for teams that pay contractors", template: "%s · Kleeno" },
  description:
    "Kleeno is AI-assisted payroll reconciliation and configuration for businesses paying remote contractors, payroll bureaus and accounting firms. Find payroll discrepancies with evidence; every amount explained. Join the waitlist.",
  applicationName: "Kleeno",
  openGraph: { siteName: "Kleeno", type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", sofia.variable)}>
      <body>{children}</body>
    </html>
  );
}
