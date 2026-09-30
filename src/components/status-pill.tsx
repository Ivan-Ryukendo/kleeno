import { cn } from "@/lib/utils";

// Status as a pill. Signal Orange is only for exceptions / DO NOT PAY (rule 45); text stays plain (rule 6).
const tone: Record<string, string> = {
  SETTLED: "bg-primary text-primary-foreground border-primary",
  PAYMENT_EXCEPTION: "bg-signal text-white border-signal",
  OFF: "bg-signal text-white border-signal",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tracking-wide",
        tone[status] ?? "bg-secondary text-secondary-foreground border-primary",
        className,
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}
