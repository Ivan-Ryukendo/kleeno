import { cn } from "@/lib/utils";

// Status as a chip (DESIGN.md §11): neutral by default, success tint when settled or on, Signal Orange only for exceptions / DO NOT PAY / OFF (rule 45). Text stays plain (rule 6).
const tone: Record<string, string> = {
  SETTLED: "border-success/30 bg-success-soft text-success",
  RECONCILED: "border-success/30 bg-success-soft text-success",
  ON: "border-success/30 bg-success-soft text-success",
  PAYMENT_EXCEPTION: "border-signal bg-signal text-white",
  OFF: "border-signal bg-signal text-white",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-chip border px-2 py-0.5 text-xs font-medium tracking-wide", tone[status] ?? "bg-secondary text-secondary-foreground", className)}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
