import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Small shared pieces for the people and settings pages (mockups workers, settings-*, help, login): chip, avatar, notice,
// panel head and settings row. Tokens only (DESIGN.md section 11); text always accompanies colour.
type Tone = "neutral" | "ok" | "risk" | "dark";
const chipTone: Record<Tone, string> = {
  neutral: "border-border bg-background text-muted-foreground",
  ok: "border-transparent bg-success-soft text-success",
  risk: "border-transparent bg-signal/10 text-signal",
  dark: "border-transparent bg-primary text-primary-foreground",
};

export function Chip({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-chip border px-1.5 text-xs leading-5 font-medium whitespace-nowrap", chipTone[tone], className)}>{children}</span>;
}

export function Avatar({ children, className, dashed = false }: { children: ReactNode; className?: string; dashed?: boolean }) {
  return <span aria-hidden="true" className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", dashed ? "border border-dashed border-field-border bg-background text-muted-foreground" : "bg-sidebar-accent", className)}>{children}</span>;
}

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

export function Notice({ tone = "neutral", icon: IconComponent, role = "note", className, children }: { tone?: "neutral" | "risk"; icon?: Icon; role?: "note" | "status" | "alert"; className?: string; children: ReactNode }) {
  return (
    <div role={role} className={cn("flex gap-2.5 rounded-card border px-3.5 py-3 text-sm", tone === "risk" ? "border-transparent bg-signal/10" : "border-border bg-secondary", className)}>
      {IconComponent && <IconComponent aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone === "risk" ? "text-signal" : "text-muted-foreground")} />}
      <div className="min-w-0 flex-1 [&>p]:m-0">{children}</div>
    </div>
  );
}

export function PanelHead({ icon: IconComponent, title, id, children }: { icon?: Icon; title: ReactNode; id?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      {IconComponent && <IconComponent aria-hidden="true" className="size-4 text-muted-foreground" />}
      <h2 id={id} className="text-sm font-medium">{title}</h2>
      {children}
    </div>
  );
}

/** Settings row: label and help on the left, control on the right (mockup `.srow`). Stacks below 700px. */
export function SettingsRow({ label, hint, htmlFor, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 border-b border-border px-4 py-3.5 last:border-b-0 min-[700px]:grid-cols-[minmax(0,13.75rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5 min-[700px]:pt-1.5">
        {htmlFor ? <label htmlFor={htmlFor} className="font-medium">{label}</label> : <span className="font-medium">{label}</span>}
        {hint && <small className="text-xs text-muted-foreground">{hint}</small>}
      </div>
      <div className="min-w-0 max-w-[27.5rem] max-[699px]:max-w-none">{children}</div>
    </div>
  );
}
