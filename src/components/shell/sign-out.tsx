"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { postJson } from "@/lib/api";

/** Ends the session on the server, then leaves the workspace. */
export function useSignOut() {
  const router = useRouter();
  return async () => {
    await postJson("/api/auth/logout");
    router.push("/login");
    router.refresh();
  };
}

/** "Sign out" inside the account chip menu. */
export function SignOutMenuItem() {
  const signOut = useSignOut();
  return (
    <DropdownMenuItem onClick={signOut}>
      <LogOut aria-hidden />
      Sign out
    </DropdownMenuItem>
  );
}
