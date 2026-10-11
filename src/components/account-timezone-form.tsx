"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TimezonePicker } from "@/components/timezone-picker";
import { requestJson } from "@/lib/api";
import { zoneCity, type TimeZoneChoice } from "@/lib/timezone-display";

export interface ProfileTimezone { preferenceTimezone: string | null; companyTimezone: string | null; timeZone: string; source: "user" | "company" | "utc"; label: string }
type Outcome = { ok: true; view: ProfileTimezone } | { ok: false; denied: boolean; message: string };

const ENDPOINT = "/api/profile/timezone";

function outcome(r: Awaited<ReturnType<typeof requestJson<ProfileTimezone>>>, fallback: string): Outcome {
  if (r.ok && r.data && typeof r.data.timeZone === "string") return { ok: true, view: r.data };
  const denied = r.status === 401 || r.status === 403;
  return { ok: false, denied, message: r.status === 401 ? "Sign in again to set your time zone." : denied ? "Sign in with your two-step code to set your time zone." : (r.error ?? fallback) };
}

/** Reads the caller's own preference; identity comes from the session, never from the request. */
export async function fetchTimezone(): Promise<Outcome> {
  return outcome(await requestJson<ProfileTimezone>(ENDPOINT, "GET"), "Your time zone could not be loaded.");
}

/** Saves an IANA ID, or null to follow the company default. */
export async function saveTimezone(timezone: string | null): Promise<Outcome> {
  return outcome(await requestJson<ProfileTimezone>(ENDPOINT, "PATCH", { timezone }), "Your time zone could not be saved.");
}

/** Label for a zone using the server-built options (same city for ICU aliases); falls back to the ID. */
export function choiceLabel(options: readonly TimeZoneChoice[], timeZone: string | null): string {
  if (!timeZone || timeZone === "UTC") return "UTC";
  return (options.find((o) => o.timeZone === timeZone) ?? options.find((o) => o.city === zoneCity(timeZone)))?.label ?? timeZone;
}

const SOURCE = { user: "your preference", company: "the company default", utc: "UTC, because no company time zone is set" } as const;

export function AccountTimezoneForm({ options }: { options: readonly TimeZoneChoice[] }) {
  const router = useRouter();
  const [view, setView] = useState<ProfileTimezone | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetchTimezone().then((r) => {
      if (!live) return;
      if (r.ok) { setView(r.view); setDraft(r.view.preferenceTimezone); setLoadError(null); }
      else setLoadError(r.message);
    });
    return () => { live = false; };
  }, [attempt]);

  if (loadError) {
    return (
      <div className="mt-4 space-y-3">
        <p role="alert" className="text-sm font-medium text-signal">{loadError}</p>
        <Button type="button" variant="outline" className="h-9 rounded-field px-4 text-sm" onClick={() => { setLoadError(null); setAttempt((n) => n + 1); }}>Try again</Button>
      </div>
    );
  }

  const companyLabel = view ? choiceLabel(options, view.companyTimezone) : "";
  const changed = !!view && draft !== view.preferenceTimezone;
  return (
    <form
      className="mt-4 space-y-4"
      aria-busy={!view || busy}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed || busy) return;
        setBusy(true);
        setMsg(null);
        const r = await saveTimezone(draft);
        if (r.ok) {
          setView(r.view);
          setDraft(r.view.preferenceTimezone);
          setMsg({ ok: true, text: `Saved. Dates and deadlines now show in ${choiceLabel(options, r.view.timeZone)}.` });
          router.refresh(); // server-rendered times pick up the new zone
        } else setMsg({ ok: false, text: r.message });
        setBusy(false);
      }}
    >
      <div className="max-w-md">
        <TimezonePicker
          id="profile-timezone"
          label="Your time zone"
          options={options}
          value={draft}
          onChange={(tz) => { setDraft(tz); setMsg(null); }}
          clearLabel={view ? `Use company default (${companyLabel})` : "Loading…"}
          describedBy="profile-timezone-now"
          disabled={!view || busy}
        />
      </div>
      <p id="profile-timezone-now" className="text-sm text-muted-foreground">
        {view ? <>Times show in <span className="font-medium text-foreground">{choiceLabel(options, view.timeZone)}</span>, from {SOURCE[view.source]}. Stored times stay in UTC.</> : "Loading your time zone…"}
      </p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm font-medium" : "text-sm font-medium text-signal"}>{msg.text}</p>}
      <Button type="submit" disabled={!changed || busy} className="h-9 rounded-field px-4 text-sm">{busy ? "Saving…" : "Save time zone"}</Button>
    </form>
  );
}
