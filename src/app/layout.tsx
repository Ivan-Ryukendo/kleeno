import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
import { cn } from "@/lib/utils";
import { env } from "@/server/env";

const sofia = localFont({ src: "./fonts/SofiaSans-Variable.ttf", weight: "1 1000", style: "normal", display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(env.SITE_URL),
  title: { default: "Kleeno · AI payroll reconciliation for teams that pay contractors", template: "%s · Kleeno" },
  description:
    "AI payroll reconciliation for teams that pay remote contractors. Every discrepancy flagged, every amount explained. Join the waitlist.",
  applicationName: "Kleeno",
  openGraph: { siteName: "Kleeno", type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
  verification: { google: "Z6g9_5j76JCHMObkCJVeXytmUDyKtjP6Ho_YMIO4OoA" }, // Search Console ownership: keep it, removing it un-verifies the site
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. QuillBot's data-qb-installed) mutate <html> before hydration; one level deep only.
    <html lang="en" className={cn("font-sans", sofia.variable)} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
