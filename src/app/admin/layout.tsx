import type { Metadata } from "next";
import { adminBase } from "@/server/auth/admin";

// The admin area is reachable only through /<ADMIN_PATH> (src/proxy.ts sets the gate header). /admin itself is a 404.
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await adminBase();
  return children;
}
