import * as React from "react";
import { cn } from "@/lib/utils";

// Field on white. Shape comes from tokens: pill on the public pages (DESIGN.md §4), 6px in the product UI (§11).
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      suppressHydrationWarning // browsers/extensions rewrite autocomplete before hydration
      className={cn(
        "h-(--field-height) w-full min-w-0 rounded-field border border-field-border bg-white px-(--field-px) text-(length:--field-text) leading-(--field-leading) outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
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
      className={cn("h-(--field-height) w-full min-w-0 rounded-field border border-field-border bg-white px-(--field-px) text-(length:--field-text) leading-(--field-leading) outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50", className)}
      {...props}
    />
  );
}

export { Input, Label, Select };
