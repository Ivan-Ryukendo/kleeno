"use client";

import { CalendarClock, Search, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Role } from "@/core/tenancy";
import type { SearchRun, SearchWorker } from "@/server/db/shell";
import { periodLabel, searchPages } from "./nav-config";

// Ctrl/Cmd+K palette over pages (including the payroll and settings screens that are not sidebar items), recent runs and
// worker codes. The index is loaded with the page (scoped by the session's company and role on the server), so searching
// needs no extra request, and it holds worker codes, never names.
export function SearchPalette({ roles, runs, workers }: { roles: Role[]; runs: SearchRun[]; workers: SearchWorker[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-11 w-11 justify-center px-0 text-muted-foreground sm:h-8 sm:w-8 md:w-56 md:justify-start md:px-2.5" onClick={() => setOpen(true)} aria-label="Search" aria-keyshortcuts="Control+K Meta+K">
        <Search aria-hidden />
        <span className="hidden md:inline">Search</span>
        <kbd className="ml-auto hidden rounded-chip border bg-muted px-1.5 font-sans text-[0.7rem] md:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page, a pay run or a worker code.">
        <Command>
          <CommandInput placeholder="Search pages, pay runs, worker codes…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Pages">
              {searchPages(roles).map((p) => (
                <CommandItem key={p.href} value={`page ${p.label}`} keywords={p.keywords?.split(" ")} onSelect={() => go(p.href)}>
                  <p.icon aria-hidden />
                  {p.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {runs.length > 0 && (
              <CommandGroup heading="Recent pay runs">
                {runs.map((r) => (
                  <CommandItem key={r.id} value={`run ${r.label} ${periodLabel(r.label)} ${r.status} ${r.mode}`} onSelect={() => go(`/runs/${encodeURIComponent(r.id)}`)}>
                    <CalendarClock aria-hidden />
                    <span>{periodLabel(r.label)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{r.status.replaceAll("_", " ").toLowerCase()}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {workers.length > 0 && (
              <CommandGroup heading="Workers">
                {workers.map((w) => (
                  <CommandItem key={w.id} value={`worker ${w.code}`} onSelect={() => go(`/workers?${new URLSearchParams({ worker: w.id })}`)}>
                    <UserRound aria-hidden />
                    {w.code}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
