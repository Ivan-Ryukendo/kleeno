import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Small building blocks of the dashboard (mockups/dashboard.html): a panel with a header bar, a status chip and a link styled as a button.
// Colours come from the Calm workspace tokens in globals.css; signal orange is only for things that block approval or payment (rule 45).

export function Panel({ id, anchor, title, icon, chip, aside, inlineAside, footer, className, children }: { id: string; anchor?: string; inlineAside?: boolean; title: string; icon?: ReactNode; chip?: ReactNode; aside?: ReactNode; footer?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={anchor} aria-labelledby={id} className={cn("min-w-0 rounded-card border bg-card", anchor && "scroll-mt-20", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        {icon}
        <h2 id={id} className="text-sm font-medium">{title}</h2>
        {chip}
        {aside && <span className={cn("ml-auto text-xs text-muted-foreground", !inlineAside && "max-sm:ml-0 max-sm:basis-full")}>{aside}</span>}
      </div>
      {children}
      {footer && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{footer}</p>}
    </section>
  );
}

const tones = {
  plain: "border-border bg-secondary text-muted-foreground",
  ok: "border-transparent bg-success-soft text-success",
  risk: "border-transparent bg-signal/10 text-signal",
  dark: "border-transparent bg-primary text-primary-foreground",
} as const;

export function Chip({ tone = "plain", className, children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex w-fit items-center gap-1 rounded-chip border px-1.5 py-px text-xs leading-5 font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

/** A link that looks like a button; 44px tall on touch screens. */
export function LinkButton({ href, variant = "outline", className, children }: { href: string; variant?: "default" | "outline" | "ghost"; className?: string; children: ReactNode }) {
  return <Link href={href} className={cn(buttonVariants({ variant, size: "sm" }), "min-h-11 gap-1.5 rounded-field px-3 text-[0.8125rem] sm:min-h-8", className)}>{children}</Link>;
}
