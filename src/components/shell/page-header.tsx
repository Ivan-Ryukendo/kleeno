import type { ReactNode } from "react";

// Page frame (DESIGN.md §11): a title, one short line of context and at most one primary action, then the content.
export function PageHeader({ title, description, actions, mono = false }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; mono?: boolean }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className={mono ? "break-all font-mono text-xl font-medium" : "text-2xl font-medium tracking-tight"}>{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
