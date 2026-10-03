"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

/** Starts a payroll run. Simulation is the default and can never pay (rule 17); the server checks the active config and the live-payments switch. */
export function NewRunForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6 grid gap-5 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const r = await postJson("/api/runs", { mode: f.get("mode"), periodStart: f.get("periodStart"), periodEnd: f.get("periodEnd") });
        if (r.ok) router.refresh();
        else setError(r.error ?? "Could not start the run");
        setBusy(false);
      }}
    >
      <div>
        <Label htmlFor="periodStart">Period start</Label>
        <Input id="periodStart" name="periodStart" type="date" required />
      </div>
      <div>
        <Label htmlFor="periodEnd">Period end</Label>
        <Input id="periodEnd" name="periodEnd" type="date" required />
      </div>
      <div>
        <Label htmlFor="mode">Mode</Label>
        <select id="mode" name="mode" defaultValue="SIMULATION" className="h-(--field-height) w-full rounded-field border border-field-border bg-white px-(--field-px) text-(length:--field-text) leading-(--field-leading) outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40">
          <option value="SIMULATION">Simulation (never pays)</option>
          <option value="LIVE_TESTNET">Live testnet</option>
        </select>
      </div>
      <div className="sm:col-span-3">
        {error && (
          <p role="alert" className="mb-3 text-sm font-medium text-signal">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-9 rounded-field px-4 text-sm">
          Start a run
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">A run needs an active configuration. Approve and activate one on the Pay policy page first.</p>
      </div>
    </form>
  );
}
