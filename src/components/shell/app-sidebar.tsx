"use client";

import { CircleUser } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar } from "@/components/ui/sidebar";
import type { Role } from "@/core/tenancy";
import { CompanySwitcher, type NavCompany } from "./company-switcher";
import { isActive, visibleNav } from "./nav-config";
import { SignOutItem } from "./sign-out";

// Left rail (DESIGN.md §11): company switcher, grouped modules for the roles that can use them, account at the foot.
export function AppSidebar({ roles, companies, activeId, canCreate, openExceptions }: { roles: Role[]; companies: NavCompany[]; activeId: string; canCreate: boolean; openExceptions: number }) {
  const pathname = usePathname();
  const { setOpenMobile, state, isMobile } = useSidebar();
  const tip = (label: string) => (state === "collapsed" && !isMobile ? label : undefined); // tooltips only while collapsed, so Escape reaches the drawer
  const groups = visibleNav(roles);
  const close = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <CompanySwitcher companies={companies} activeId={activeId} canCreate={canCreate} />
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label ?? "main"}>
            {g.label && <SidebarGroupLabel>{g.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((i) => {
                  const active = isActive(i, pathname);
                  return (
                    <SidebarMenuItem key={i.href}>
                      <SidebarMenuButton render={<Link href={i.href} onClick={close} />} isActive={active} tooltip={tip(i.label)} aria-current={active ? "page" : undefined}>
                        <i.icon aria-hidden />
                        <span>{i.label}</span>
                      </SidebarMenuButton>
                      {i.badge === "exceptions" && openExceptions > 0 && (
                        <SidebarMenuBadge aria-label={`${openExceptions} open`} className="bg-signal text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
                          {openExceptions > 99 ? "99+" : openExceptions}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/account" onClick={close} />} isActive={pathname === "/account"} tooltip={tip("Account")}>
              <CircleUser aria-hidden />
              <span>Account</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SignOutItem />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
