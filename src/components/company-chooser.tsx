"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/api";

export interface ChooserCompany {
  id: string;
  name: string;
  roles: string;
}

// Picks the active company (S61). Shown only when no valid choice exists yet (several companies, or a stale cookie).
export function CompanyChooser({ companies, next = "/dashboard" }: { companies: ChooserCompany[]; next?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(id: string) {
    setBusy(id);
    setError(null);
    const r = await postJson("/api/companies/switch", { target: id });
    if (!r.ok) {
      setError(r.error ?? "Could not switch company");
      setBusy(null);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mt-8">
      <ul className="space-y-3">
        {companies.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => choose(c.id)}
              className="flex w-full items-center justify-between gap-4 rounded-[1.25rem] border border-primary bg-card px-6 py-4 text-left transition-shadow hover:shadow-card disabled:opacity-60"
            >
              <span className="text-lg font-medium">{c.name}</span>
              <span className="text-sm text-muted-foreground">{c.roles}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
