"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { filterTimeZones, moveActive, zoneCity, type TimeZoneChoice } from "@/lib/timezone-display";

const CLEAR = "__clear__";

/** Searchable timezone combobox (WAI-ARIA 1.2 editable combobox with list autocomplete).
 * Options come from the server page (timeZoneChoices) so labels and offsets hydrate identically. `null` = no preference. */
export function TimezonePicker({ id, label, options, value, onChange, clearLabel, describedBy, disabled = false, required = false, name }: {
  id: string;
  label: string;
  options: readonly TimeZoneChoice[];
  value: string | null;
  onChange: (timeZone: string | null) => void;
  /** Shows a first option that clears the value (e.g. "Use company default"). */
  clearLabel?: string;
  describedBy?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
}) {
  const listId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  // Stored IDs may be aliases of the ICU canonical ID (Asia/Kolkata vs Asia/Calcutta): fall back to the same city.
  const selected = value ? (options.find((o) => o.timeZone === value) ?? options.find((o) => o.city === zoneCity(value))) : undefined;
  const display = value ? (selected?.label ?? value) : (clearLabel ?? "");
  const matches = useMemo(() => filterTimeZones(options, query), [options, query]);
  const rows = useMemo(() => [...(clearLabel && !query ? [{ key: CLEAR, label: clearLabel, region: "", timeZone: null as string | null }] : []), ...matches.map((m) => ({ key: m.timeZone, label: m.label, region: m.region, timeZone: m.timeZone as string | null }))], [clearLabel, query, matches]);
  const optionId = (i: number) => `${listId}-o${i}`;

  function show(index: number) {
    setActive(index);
    requestAnimationFrame(() => {
      listRef.current?.scrollIntoView({ block: "nearest" }); // small screens: bring the whole list on screen
      document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
    });
  }
  function openList() {
    if (disabled || open) return;
    setOpen(true);
    setQuery("");
    const index = selected ? options.indexOf(selected) : -1;
    const current = clearLabel ? (value ? index + 1 : 0) : index;
    show(Math.max(current, 0));
  }
  function close() { setOpen(false); setQuery(""); setActive(-1); }
  function choose(index: number) {
    const row = rows[index];
    if (!row) return;
    onChange(row.timeZone);
    close();
  }

  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="mb-2 block text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && rows[active] ? optionId(active) : undefined}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(" ")}
          aria-required={required || undefined}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={open ? "Search city, region or UTC offset" : "Choose a time zone"}
          value={open ? query : display}
          onFocus={openList}
          onClick={openList}
          onBlur={(e) => { if (!listRef.current?.contains(e.relatedTarget as Node)) close(); }}
          onChange={(e) => { if (!open) setOpen(true); setQuery(e.target.value); setActive(e.target.value ? 0 : -1); }}
          onKeyDown={(e) => {
            if (!open) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openList(); }
              return;
            }
            if (e.key === "Enter") { e.preventDefault(); if (active >= 0) choose(active); return; }
            if (e.key === "Escape") { e.preventDefault(); if (query) { setQuery(""); setActive(-1); } else close(); return; }
            if (e.key === "Tab") { close(); return; }
            const next = moveActive(e.key, active, rows.length);
            if (next !== null) { e.preventDefault(); show(next); }
          }}
          className="h-(--field-height) w-full min-w-0 truncate rounded-field border border-field-border bg-white pr-9 pl-(--field-px) text-(length:--field-text) leading-(--field-leading) outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
        />
        <svg aria-hidden="true" viewBox="0 0 16 16" className={cn("pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground transition-transform", open && "rotate-180")}><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {name && <input type="hidden" name={name} value={value ?? ""} />}
      </div>
      <p id={hintId} className="sr-only">Type to filter. Use the arrow keys, Home and End to move, Enter to choose, Escape to close.</p>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={`${label} options`}
        hidden={!open}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onBlur={(e) => { if (e.relatedTarget !== inputRef.current) close(); }}
        className="absolute inset-x-0 top-full z-50 mt-1 max-h-[min(18rem,50dvh)] scroll-my-2 overflow-y-auto overscroll-contain rounded-box border border-border bg-popover p-1 text-sm text-popover-foreground shadow-pop"
      >
        {rows.map((row, i) => {
          const isSelected = row.timeZone === (selected?.timeZone ?? value);
          return (
            <li
              key={row.key}
              id={optionId(i)}
              role="option"
              aria-selected={isSelected}
              onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
              onMouseMove={() => active !== i && setActive(i)}
              onClick={() => choose(i)}
              className={cn("flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-chip px-2 py-1.5", i === active && "bg-accent outline-2 -outline-offset-2 outline-primary", row.key === CLEAR && "border-b border-border")}
            >
              <span className="min-w-0">
                <span className={cn("block truncate", isSelected && "font-medium")}>{row.label}</span>
                {row.region && <span className="block truncate text-xs text-muted-foreground">{row.region}</span>}
              </span>
              {isSelected && <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </li>
          );
        })}
        {rows.length === 0 && <li role="presentation" className="px-2 py-3 text-muted-foreground">No time zone matches &ldquo;{query}&rdquo;. Try a city, region or offset like UTC+6.</li>}
      </ul>
      <p aria-live="polite" className="sr-only">{open ? `${matches.length} time zones` : ""}</p>
    </div>
  );
}
