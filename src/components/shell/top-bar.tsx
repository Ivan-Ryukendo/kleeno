"use client";

import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Role } from "@/core/tenancy";
import type { ShellData } from "@/server/db/shell";
import { crumbs } from "./nav-config";
import { Notifications } from "./notifications";
import { SearchPalette } from "./search-palette";

// Slim top bar (mockups): company / section / run / view on the left; search, to-dos and the mode on the right.
// Starting a run lives on the dashboard and in the search palette ("Start a pay run"), for payroll roles.
export function TopBar({ roles, data, live, company }: { roles: Role[]; data: ShellData; live: boolean; company: string | undefined }) {
  const pathname = usePathname();
  const trail = crumbs(pathname, { company, runs: data.runs });
  const last = trail.length - 1;

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mx-1 hidden h-4 sm:block" />
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          {trail.map((c, i) => (
            // Small screens keep only where I am; the company and section return from 640px up.
            <Fragment key={`${i}-${c}`}>
              {i > 0 && <li aria-hidden className="hidden sm:block">/</li>}
              <li className={i === last ? "min-w-0 truncate font-medium text-foreground" : "hidden shrink-0 truncate sm:block"} aria-current={i === last ? "page" : undefined}>
                {c}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <SearchPalette roles={roles} runs={data.runs} workers={data.workers} />
        <Notifications todos={data.todos} />
        <Badge variant={live ? "success" : "secondary"} className="border-border" title={live ? "Live payments are on (Arc testnet USDC, no real funds)" : "Simulation: runs never pay"}>
          {live ? "LIVE TESTNET" : "SIMULATION"}
        </Badge>
      </div>
    </header>
  );
}
