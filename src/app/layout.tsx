import type { Metadata } from "next";
import "./globals.css";
import { Sofia_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const sofia = Sofia_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Kleeno",
  description: "AI-assisted payroll with USDC settlement on Arc testnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", sofia.variable)}>
      <body>{children}</body>
    </html>
  );
}
