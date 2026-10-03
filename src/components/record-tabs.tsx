"use client";

import { useState } from "react";
import { TableView, type TableViewProps } from "@/components/table-view";
import type { TableId } from "@/core/views";

const LABEL: Partial<Record<TableId, string>> = { timesheets: "Timesheets", leave: "Leave", exceptions: "All exceptions" };

/** Tabs over several table views of one run. Each keeps its own columns, filters and sort while you switch. */
export function RecordTabs({ tables }: { tables: TableViewProps[] }) {
  const [active, setActive] = useState(tables[0]?.table);
  return (
    <div>
      <div role="tablist" className="mt-4 flex flex-wrap gap-2">
        {tables.map((t) => (
          <button key={t.table} role="tab" aria-selected={t.table === active} type="button" onClick={() => setActive(t.table)} className={`rounded-field border px-3 py-1.5 text-sm ${t.table === active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
            {LABEL[t.table] ?? t.table}
          </button>
        ))}
      </div>
      {tables.map((t) => (
        <div key={t.table} hidden={t.table !== active}>
          <TableView {...t} />
        </div>
      ))}
    </div>
  );
}
