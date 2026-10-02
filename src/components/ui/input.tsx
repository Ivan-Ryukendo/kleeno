import * as React from "react";
import { cn } from "@/lib/utils";

// Pill input on white (DESIGN.md: inputs use pill or 20px radius, 1px border).
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      suppressHydrationWarning // browsers/extensions rewrite autocomplete before hydration
      className={cn(
        "h-11 w-full min-w-0 rounded-full border border-primary/50 bg-white px-5 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("mb-2 block text-sm font-medium", className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      suppressHydrationWarning
      className={cn("h-11 w-full min-w-0 rounded-full border border-primary/50 bg-white px-5 text-base outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50", className)}
      {...props}
    />
  );
}

export { Input, Label, Select };
