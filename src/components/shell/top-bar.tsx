"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Role } from "@/core/tenancy";
import type { ShellData } from "@/server/db/shell";
import { crumbs } from "./nav-config";
import { Notifications } from "./notifications";
import { SearchPalette } from "./search-palette";

// Slim top bar (DESIGN.md §11): where I am on the left; search, to-dos, "Run payroll" and the mode on the right.
export function TopBar({ roles, data, canRun, live }: { roles: Role[]; data: ShellData; canRun: boolean; live: boolean }) {
  const pathname = usePathname();
  const trail = crumbs(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mx-1 hidden h-4 sm:block" />
      <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
        <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {trail.map((c, i) => (
            <Fragment key={c}>
              {i > 0 && <li aria-hidden>/</li>}
              <li className={i === trail.length - 1 ? "truncate font-medium text-foreground" : "truncate"} aria-current={i === trail.length - 1 ? "page" : undefined}>
                {c}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <SearchPalette roles={roles} runs={data.runs} workerCodes={data.workerCodes} />
        <Notifications todos={data.todos} />
        {canRun && (
          <Link href="/dashboard#start-run" className={buttonVariants({ size: "sm", className: "h-8 px-3" })}>
            Run payroll
          </Link>
        )}
        <Badge variant={live ? "success" : "secondary"} className="border-border" title={live ? "Live payments are on (Arc testnet USDC, no real funds)" : "Simulation: runs never pay"}>
          {live ? "LIVE TESTNET" : "SIMULATION"}
        </Badge>
      </div>
    </header>
  );
}
