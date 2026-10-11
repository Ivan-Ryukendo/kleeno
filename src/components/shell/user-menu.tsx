"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronsUpDown, CircleUser } from "lucide-react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { ROLE_LABELS, type Role } from "@/core/tenancy";
import { initials } from "./nav-config";
import { SignOutMenuItem } from "./sign-out";

const itemClass = "relative flex min-h-11 cursor-default sm:min-h-9 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0";

/** Account chip at the foot of the sidebar (mockup `.me`): email initials and roles; the menu holds Account and Sign out. */
export function UserMenu({ email, roles }: { email: string | null; roles: readonly Role[] }) {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const roleText = roles.map((r) => ROLE_LABELS[r]).join(", ");
  const name = email ?? "Signed in";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" tooltip={state === "collapsed" && !isMobile ? name : undefined} aria-label={`Account menu for ${name}`} className="data-popup-open:bg-sidebar-accent" />}
          >
            <span aria-hidden className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-foreground">
              {initials(email)}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{roleText}</span>
            </span>
            <ChevronsUpDown aria-hidden className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <MenuPrimitive.LinkItem render={<Link href="/account" />} closeOnClick onClick={() => setOpenMobile(false)} className={itemClass}>
              <CircleUser aria-hidden />
              Account
            </MenuPrimitive.LinkItem>
            <SignOutMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
