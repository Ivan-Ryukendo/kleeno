import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Role } from "@/core/tenancy";
import type { ShellData } from "@/server/db/shell";
import { AppSidebar } from "./app-sidebar";
import type { NavCompany } from "./company-switcher";
import { TopBar } from "./top-bar";

export interface ShellProps {
  roles: Role[];
  /** Sign-in email for the account chip (no display name is stored). */
  email: string | null;
  companies: NavCompany[];
  activeId: string;
  canCreate: boolean;
  live: boolean;
  data: ShellData;
  defaultOpen: boolean;
  children: ReactNode;
}

// The workspace frame (docs/phases/P4u.md): sidebar + top bar around every signed-in working page. `app-theme` switches the
// product tokens on (globals.css); the public pages never carry it.
export function AppShell({ roles, email, companies, activeId, canCreate, live, data, defaultOpen, children }: ShellProps) {
  return (
    <div className="app-theme">
      <TooltipProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-field focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
            Skip to content
          </a>
          <AppSidebar roles={roles} companies={companies} activeId={activeId} canCreate={canCreate} openExceptions={data.openExceptions} runs={data.runs} email={email} />
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <TopBar roles={roles} data={data} live={live} company={companies.find((c) => c.id === activeId)?.name} />
            <SidebarInset id="main" className="min-w-0 px-4 pt-5 pb-12 sm:px-6">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  );
}
