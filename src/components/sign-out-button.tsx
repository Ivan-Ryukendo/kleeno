"use client";

import { useRouter } from "next/navigation";
import { postJson } from "@/lib/api";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-base font-medium text-muted-foreground underline-offset-4 hover:underline"
      onClick={async () => {
        await postJson("/api/auth/logout");
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
