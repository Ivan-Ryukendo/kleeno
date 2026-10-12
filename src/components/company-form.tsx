"use client";

import { Lock } from "lucide-react";
import { useState, type ReactNode } from "react";
import { INDUSTRIES, PAY_FREQUENCIES, SIZE_RANGES, WEEKDAYS, type CompanyProfile } from "@/core/company";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Chip, SettingsRow } from "@/components/people-ui";
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

type Layout = "stack" | "rows";

/** One field. "stack" is the onboarding card (label above); "rows" is the settings panel (label and hint left, control right). */
function Field({ layout, label, hint, htmlFor, children }: { layout: Layout; label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  if (layout === "rows") return <SettingsRow label={label} hint={hint} htmlFor={htmlFor}>{children}</SettingsRow>;
  return <div>{htmlFor && <Label htmlFor={htmlFor}>{label}</Label>}{children}</div>;
}

function FormFooter({ layout, disabled, busy, saved, error, submitLabel, canSubmit = true, note }: { layout: Layout; disabled: boolean; busy: boolean; saved: boolean; error: string | null; submitLabel: string; canSubmit?: boolean; note?: string }) {
  const submit = !disabled && (
    <Button type="submit" disabled={busy || !canSubmit} className={layout === "rows" ? "h-8 rounded-field px-3 text-[13px]" : "h-9 rounded-field px-4 text-sm"}>
      {submitLabel}
    </Button>
  );
  if (layout === "stack") return <>{<Message error={error} />}{saved && <p role="status" className="text-sm font-medium">Saved.</p>}{submit}</>;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 basis-56">{note}</span>
      <Message error={error} />
      {saved && <p role="status" className="text-sm font-medium text-foreground">Saved.</p>}
      {submit}
    </div>
  );
}

export interface BasicsOptions {
  countries: { code: string; name: string }[];
  zones: TimeZoneChoice[];
}

/** Company name, country, time zone, size and industry. Saves through POST /api/company (Owner only).
 * The country and time zone lists come from the server page: Intl data differs between Node and the browser, so building them here mismatches on hydration. */
export function BasicsForm({ profile, options, submitLabel = "Save", disabled = false, onSaved, layout = "stack" }: { profile: CompanyProfile; options: BasicsOptions; submitLabel?: string; disabled?: boolean; onSaved?: () => void; layout?: Layout }) {
  const { countries, zones } = options;
  const [zone, setZone] = useState(profile.timezone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = layout === "rows";

  return (
    <form
      className={rows ? "" : "space-y-5"}
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
      <Field layout={layout} label={rows ? "Display name" : "Company name"} hint="What your team sees in the switcher." htmlFor="name">
        <Input id="name" name="name" defaultValue={profile.name ?? ""} maxLength={120} required disabled={disabled} />
      </Field>
      <div className={rows ? "contents" : "grid gap-5 sm:grid-cols-2"}>
        <Field layout={layout} label="Country" hint="Where the company is registered." htmlFor="country">
          <Select id="country" name="country" defaultValue={profile.country ?? ""} required disabled={disabled} autoComplete="country-name">
            <option value="" disabled>
              Choose a country
            </option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {rows && (
          <SettingsRow label="Currency" hint="Fixed for every company today.">
            <p className="flex flex-wrap items-center gap-2 pt-1.5">
              <Chip>USD</Chip>US dollar
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Lock aria-hidden="true" className="size-3" />Can&apos;t be changed</span>
            </p>
            <small className="mt-1.5 block text-xs text-muted-foreground">Imports and pay are in US dollars. Payments settle as Arc testnet USDC, no real funds.</small>
          </SettingsRow>
        )}
        <Field layout={layout} label="Time zone" hint="Cutoffs and pay dates use this time zone.">
          <div>
            <div className={rows ? "[&_label]:sr-only" : undefined}>
              <TimezonePicker id="timezone" label="Time zone" options={zones} value={zone || null} onChange={(tz) => setZone(tz ?? "")} required disabled={disabled} />
            </div>
            {!disabled && (
              <button type="button" className="mt-2 min-h-8 text-sm underline underline-offset-4" onClick={() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>
                Use this computer&apos;s time zone
              </button>
            )}
          </div>
        </Field>
        <Field layout={layout} label="Team size" hint="Roughly how many people you pay." htmlFor="sizeRange">
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
        </Field>
        <Field layout={layout} label="Industry" hint="How you describe the business." htmlFor="industry">
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
        </Field>
      </div>
      {!rows && <p className="text-sm text-muted-foreground">Payments are in USD (shown as USDC on Arc testnet).</p>}
      <FormFooter layout={layout} disabled={disabled} busy={busy} saved={saved} error={error} submitLabel={submitLabel} note={disabled ? "Only an Owner can change these details." : "Saved changes are recorded in the audit log."} />
    </form>
  );
}

/** How often you pay and on which day. Saves through POST /api/company (Owner only). */
export function ScheduleForm({ profile, submitLabel = "Save", disabled = false, onSaved, layout = "stack" }: { profile: CompanyProfile; submitLabel?: string; disabled?: boolean; onSaved?: () => void; layout?: Layout }) {
  const [frequency, setFrequency] = useState(profile.payFrequency ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = layout === "rows";

  return (
    <form
      className={rows ? "" : "space-y-5"}
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
      <div className={rows ? "contents" : "grid gap-5 sm:grid-cols-2"}>
        <Field layout={layout} label={rows ? "Pay frequency" : "How often do you pay?"} hint="One pay run per period." htmlFor="payFrequency">
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
        </Field>
        {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
          <Field layout={layout} label={rows ? "Pay day" : "Usual pay day"} hint="The weekday people are paid." htmlFor="payDay">
            <Select id="payDay" name="payDay" defaultValue={profile.payDay && profile.payDay <= 7 ? String(profile.payDay) : "5"} disabled={disabled}>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {frequency === "MONTHLY" && (
          <Field layout={layout} label={rows ? "Pay date" : "Usual pay day"} hint="The day of the month people are paid." htmlFor="payDay">
            <Select id="payDay" name="payDay" defaultValue={profile.payDay ? String(profile.payDay) : "25"} disabled={disabled}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
              <option value={31}>Last day of the month</option>
            </Select>
          </Field>
        )}
        {frequency === "SEMI_MONTHLY" && (rows ? <SettingsRow label="Pay dates"><p className="pt-1.5">Paid on the 15th and the last day of each month.</p></SettingsRow> : <p className="self-end pb-3 text-sm text-muted-foreground">Paid on the 15th and the last day of each month.</p>)}
      </div>
      <FormFooter layout={layout} disabled={disabled} busy={busy} saved={saved} error={error} submitLabel={submitLabel} canSubmit={!!frequency} note={disabled ? "Only an Owner can change the pay schedule." : "Saved changes are recorded in the audit log."} />
    </form>
  );
}
