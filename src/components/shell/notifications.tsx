"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Todo } from "@/server/db/shell";

// The bell: what is waiting for me, derived from existing data, each with its reason and a link (nothing stored, nothing to dismiss).
export function Notifications({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label={todos.length ? `To-dos, ${todos.length} waiting` : "To-dos, nothing waiting"} />}>
        <Bell aria-hidden />
        {todos.length > 0 && <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-chip bg-signal px-1 text-[0.65rem] font-medium text-white tabular-nums">{todos.length > 9 ? "9+" : todos.length}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <p className="border-b px-3 py-2 text-sm font-medium">My to-dos</p>
        {todos.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing is waiting for you.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {todos.map((t) => (
              <li key={t.id}>
                <Link href={t.href} onClick={() => setOpen(false)} className="flex items-start gap-2 px-3 py-2.5 text-sm outline-none hover:bg-muted focus-visible:bg-muted">
                  <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === "risk" ? "bg-signal" : "bg-primary"}`} />
                  <span>{t.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
