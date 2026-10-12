"use client";

import { useState } from "react";
import { INDUSTRIES, PAY_FREQUENCIES, SIZE_RANGES, WEEKDAYS, type CompanyProfile } from "@/core/company";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { postJson } from "@/lib/api";
import { TimezonePicker } from "@/components/timezone-picker";
import type { TimeZoneChoice } from "@/lib/timezone-display";

function Message({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm font-medium text-signal">
      {error}
    </p>
  ) : null;
}

export interface BasicsOptions {
  countries: { code: string; name: string }[];
  zones: TimeZoneChoice[];
}

/** Company name, country, time zone, size and industry. Saves through POST /api/company (Owner only).
 * The country and time zone lists come from the server page: Intl data differs between Node and the browser, so building them here mismatches on hydration. */
export function BasicsForm({ profile, options, submitLabel = "Save", disabled = false, onSaved }: { profile: CompanyProfile; options: BasicsOptions; submitLabel?: string; disabled?: boolean; onSaved?: () => void }) {
  const { countries, zones } = options;
  const [zone, setZone] = useState(profile.timezone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (!zone) {
          setError("Choose a time zone");
          return;
        }
        setBusy(true);
        setError(null);
        setSaved(false);
        const r = await postJson("/api/company", { name: f.get("name"), country: f.get("country"), timezone: zone, sizeRange: f.get("sizeRange"), industry: f.get("industry") });
        if (!r.ok) setError(r.error ?? "Could not save");
        else {
          setSaved(true);
          onSaved?.();
        }
        setBusy(false);
      }}
    >
      <div>
        <Label htmlFor="name">Company name</Label>
        <Input id="name" name="name" defaultValue={profile.name ?? ""} maxLength={120} required disabled={disabled} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="country">Country</Label>
          <Select id="country" name="country" defaultValue={profile.country ?? ""} required disabled={disabled}>
            <option value="" disabled>
              Choose a country
            </option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <TimezonePicker id="timezone" label="Time zone" options={zones} value={zone || null} onChange={(tz) => setZone(tz ?? "")} required disabled={disabled} />
          {!disabled && (
            <button type="button" className="mt-2 text-sm underline underline-offset-4" onClick={() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>
              Use this computer&apos;s time zone
            </button>
          )}
        </div>
        <div>
          <Label htmlFor="sizeRange">Team size</Label>
          <Select id="sizeRange" name="sizeRange" defaultValue={profile.sizeRange ?? ""} required disabled={disabled}>
            <option value="" disabled>
              Choose a range
            </option>
            {Object.entries(SIZE_RANGES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="industry">Industry</Label>
          <Select id="industry" name="industry" defaultValue={profile.industry ?? ""} required disabled={disabled}>
            <option value="" disabled>
              Choose an industry
            </option>
            {Object.entries(INDUSTRIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Payments are in USD (shown as USDC on Arc testnet).</p>
      <Message error={error} />
      {saved && <p role="status" className="text-sm font-medium">Saved.</p>}
      {!disabled && (
        <Button type="submit" disabled={busy} className="h-9 rounded-field px-4 text-sm">
          {submitLabel}
        </Button>
      )}
    </form>
  );
}

/** How often you pay and on which day. Saves through POST /api/company (Owner only). */
export function ScheduleForm({ profile, submitLabel = "Save", disabled = false, onSaved }: { profile: CompanyProfile; submitLabel?: string; disabled?: boolean; onSaved?: () => void }) {
  const [frequency, setFrequency] = useState(profile.payFrequency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        setSaved(false);
        const day = frequency === "SEMI_MONTHLY" ? null : Number(f.get("payDay"));
        const r = await postJson("/api/company", { payFrequency: frequency, payDay: day });
        if (!r.ok) setError(r.error ?? "Could not save");
        else {
          setSaved(true);
          onSaved?.();
        }
        setBusy(false);
      }}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="payFrequency">How often do you pay?</Label>
          <Select id="payFrequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} required disabled={disabled}>
            <option value="" disabled>
              Choose
            </option>
            {Object.entries(PAY_FREQUENCIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
          <div>
            <Label htmlFor="payDay">Usual pay day</Label>
            <Select id="payDay" name="payDay" defaultValue={profile.payDay && profile.payDay <= 7 ? String(profile.payDay) : "5"} disabled={disabled}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        )}
        {frequency === "MONTHLY" && (
          <div>
            <Label htmlFor="payDay">Usual pay day</Label>
            <Select id="payDay" name="payDay" defaultValue={profile.payDay ? String(profile.payDay) : "25"} disabled={disabled}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
              <option value={31}>Last day of the month</option>
            </Select>
          </div>
        )}
        {frequency === "SEMI_MONTHLY" && <p className="self-end pb-3 text-sm text-muted-foreground">Paid on the 15th and the last day of each month.</p>}
      </div>
      <Message error={error} />
      {saved && <p role="status" className="text-sm font-medium">Saved.</p>}
      {!disabled && (
        <Button type="submit" disabled={busy || !frequency} className="h-9 rounded-field px-4 text-sm">
          {submitLabel}
        </Button>
      )}
    </form>
  );
}
