"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarSeparator, useSidebar } from "@/components/ui/sidebar";
import type { Role } from "@/core/tenancy";
import { CompanySwitcher, type NavCompany } from "./company-switcher";
import { isActive, sidebarNav, type RunRef } from "./nav-config";
import { UserMenu } from "./user-menu";

// Left rail (mockups/payroll-table.html): company switcher; Dashboard · Payroll · All Workers; a hairline; Settings · Help;
// the account chip at the foot. Active item = grey fill, no indicator bar.
export function AppSidebar({ roles, companies, activeId, canCreate, openExceptions, runs, email }: { roles: Role[]; companies: NavCompany[]; activeId: string; canCreate: boolean; openExceptions: number; runs: RunRef[]; email: string | null }) {
  const pathname = usePathname();
  const { setOpenMobile, state, isMobile } = useSidebar();
  const tip = (label: string) => (state === "collapsed" && !isMobile ? label : undefined); // tooltips only while collapsed, so Escape reaches the drawer
  const groups = sidebarNav(roles, runs);
  const close = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <CompanySwitcher companies={companies} activeId={activeId} canCreate={canCreate} />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.map((g, index) => (
          <Fragment key={g.id}>
            {index > 0 && <SidebarSeparator className="mx-3 my-1" />}
            <SidebarGroup className="py-1.5">
              <SidebarGroupContent>
                <SidebarMenu className="gap-px">
                  {g.items.map((i) => {
                    const active = isActive(i, pathname);
                    const count = i.badge === "exceptions" ? openExceptions : 0;
                    return (
                      <SidebarMenuItem key={i.label}>
                        <SidebarMenuButton
                          render={<Link href={i.href} onClick={close} />}
                          isActive={active}
                          tooltip={tip(count > 0 ? `${i.label}, ${count} open` : i.label)}
                          aria-current={active ? "page" : undefined}
                          aria-label={count > 0 ? `${i.label}, ${count} open ${count === 1 ? "exception" : "exceptions"}` : undefined}
                          className="gap-2.5 font-medium text-muted-foreground data-active:text-foreground hover:text-foreground"
                        >
                          <i.icon aria-hidden />
                          <span>{i.label}</span>
                        </SidebarMenuButton>
                        {count > 0 && (
                          // Signal Orange text on a white chip: risk text stays AA (never small orange text on the sidebar tint, DESIGN.md §11).
                          <SidebarMenuBadge aria-hidden className="rounded-chip bg-background text-xs font-semibold text-signal peer-hover/menu-button:text-signal peer-data-active/menu-button:text-signal">
                            {count > 99 ? "99+" : count}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </Fragment>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <UserMenu email={email} roles={roles} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
