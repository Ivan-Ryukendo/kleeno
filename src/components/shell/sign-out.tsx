"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { postJson } from "@/lib/api";

export function SignOutItem() {
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  return (
    <SidebarMenuButton
      tooltip={state === "collapsed" && !isMobile ? "Sign out" : undefined}
      onClick={async () => {
        await postJson("/api/auth/logout");
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut aria-hidden />
      <span>Sign out</span>
    </SidebarMenuButton>
  );
}
