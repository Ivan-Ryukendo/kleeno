"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { postJson } from "@/lib/api";

export interface NavCompany {
  id: string;
  name: string;
}

// Left end of the nav pill: the active company, the companies this login belongs to, and "Create company" for Owners (S64, S65).
export function CompanySwitcher({ companies, activeId, canCreate }: { companies: NavCompany[]; activeId: string; canCreate: boolean }) {
  const router = useRouter();
  const menu = useRef<HTMLDetailsElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = companies.find((c) => c.id === activeId);

  async function go(call: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await call;
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong");
    if (menu.current) menu.current.open = false;
    setCreating(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <details ref={menu} className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-base font-medium marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="max-w-40 truncate">{active?.name ?? "Company"}</span>
        <span aria-hidden className="text-xs transition-transform duration-150 group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-3 w-72 rounded-[1.5rem] bg-white p-3 shadow-card">
        <ul className="space-y-1">
          {companies.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy || c.id === activeId}
                onClick={() => go(postJson("/api/companies/switch", { target: c.id }))}
                className="flex w-full items-center justify-between gap-3 rounded-full px-4 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="truncate">{c.name}</span>
                {c.id === activeId && <span className="text-xs text-muted-foreground">Active</span>}
              </button>
            </li>
          ))}
        </ul>
        {canCreate && (
          <div className="mt-2 border-t border-border pt-2">
            {creating ? (
              <form
                className="space-y-2 px-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  go(postJson("/api/companies", { name: new FormData(e.currentTarget).get("name") }));
                }}
              >
                <input name="name" required maxLength={120} placeholder="Company name" aria-label="New company name" className="h-10 w-full rounded-full border border-primary/50 bg-white px-4 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40" />
                <button type="submit" disabled={busy} className="h-9 w-full rounded-full bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50">
                  Create company
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setCreating(true)} className="w-full rounded-full px-4 py-2 text-left text-sm font-medium hover:bg-muted">
                + Create company
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 px-3 text-sm font-medium text-signal">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
