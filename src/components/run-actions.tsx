"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/api";

/** Runs the deterministic engine on the reconciled data. The server refuses unless every exception is resolved. */
export function CalculateButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <Button
        type="button"
        disabled={busy}
        className="h-11 rounded-[1.25rem] px-6 text-base"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson(`/api/runs/${runId}/calculate`);
          if (r.ok) router.refresh();
          else setError(r.error ?? "The calculation failed");
          setBusy(false);
        }}
      >
        {busy ? "Calculating…" : "Calculate pay"}
      </Button>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
