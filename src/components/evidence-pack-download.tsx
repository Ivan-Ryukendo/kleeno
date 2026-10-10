"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function EvidencePackDownload({ runId, available, disabled = false, onDenied }: { runId: string; available: boolean; disabled?: boolean; onDenied?: (message: string) => void }) {
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function download() {
    if (busy || disabled || !available) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/evidence`, { cache: "no-store" });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          const message = "Review access changed. Reload this run to check your current access.";
          setError(message); onDenied?.(message); return;
        }
        setError(response.status === 409 ? "This calculation evidence could not be reproduced. Reload and check the recorded sign-off and CSV." : "Calculation evidence could not be downloaded. Try again or reload this run.");
        return;
      }
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(value => value.toString(16).padStart(2, "0")).join("");
      if (response.headers.get("content-type") !== "application/zip" || bytes.byteLength > 20 * 1024 * 1024 || hash !== response.headers.get("x-content-sha256")) {
        setError("The evidence file failed its integrity check. Nothing was downloaded."); return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const link = document.createElement("a"); link.href = url; link.download = `kleeno-signed-calculation-v1-${runId}.zip`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Calculation evidence downloaded. Keep this payroll file private.");
    } catch { setError("Calculation evidence could not be downloaded. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return <div className="mt-4 min-w-0 rounded-box border border-border p-3 text-sm" aria-busy={busy}>
    <h3 className="font-medium">Portable calculation evidence</h3>
    <p id={hintId} className="mt-2 text-muted-foreground">Recorded human review, captured calculation inputs and traces, reviewed CSV and file hashes. This contains confidential payroll data and does not prove delivery or payment settlement.</p>
    {!available && <p className="mt-2 text-muted-foreground">Sign off and generate the reviewed CSV first.</p>}
    <Button type="button" disabled={!available || disabled || busy} aria-describedby={hintId} className="mt-3 min-h-11 max-w-full rounded-field px-4 text-sm whitespace-normal" style={{ transition: "none", transform: "none" }} onClick={download}>{busy ? "Preparing calculation evidence…" : "Download calculation evidence ZIP"}</Button>
    {error && <p role="alert" tabIndex={-1} ref={errorRef} className="mt-3 text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{error}</p>}
    {notice && <p role="status" className="mt-3">{notice}</p>}
  </div>;
}
