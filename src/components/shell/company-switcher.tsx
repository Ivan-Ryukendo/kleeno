"use client";

import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input, Label } from "@/components/ui/input";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { postJson } from "@/lib/api";

export interface NavCompany {
  id: string;
  name: string;
}

// Top of the sidebar: the active company, the companies this login belongs to, and "Create company" for Owners (S64, S65).
export function CompanySwitcher({ companies, activeId, canCreate }: { companies: NavCompany[]; activeId: string; canCreate: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = companies.find((c) => c.id === activeId);
  const { state, isMobile } = useSidebar();

  async function go(call: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const r = await call;
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong");
    setCreating(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={state === "collapsed" && !isMobile ? (active?.name ?? "Company") : undefined} aria-label="Switch company" className="data-popup-open:bg-sidebar-accent" />}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-box bg-primary text-primary-foreground">
              <Building2 aria-hidden />
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate font-medium">{active?.name ?? "Company"}</span>
              <span className="truncate text-xs text-muted-foreground">Kleeno</span>
            </span>
            <ChevronsUpDown aria-hidden className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>My companies</DropdownMenuLabel>
              {companies.map((c) => (
                <DropdownMenuItem key={c.id} disabled={busy || c.id === activeId} onClick={() => go(postJson("/api/companies/switch", { target: c.id }))}>
                  <span className="truncate">{c.name}</span>
                  {c.id === activeId && <Check aria-label="Active" className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {error && (
              <p role="alert" className="px-1.5 py-1 text-xs font-medium text-signal">
                {error}
              </p>
            )}
            {canCreate && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setCreating(true)}>
                  <Plus aria-hidden />
                  Create company
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create company</DialogTitle>
            <DialogDescription>A new company starts in simulation with live payments off. You become its Owner.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              go(postJson("/api/companies", { name: new FormData(e.currentTarget).get("name") }));
            }}
          >
            <div>
              <Label htmlFor="new-company-name">Company name</Label>
              <Input id="new-company-name" name="name" required maxLength={120} autoFocus />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-signal">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy}>
              Create company
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </SidebarMenu>
  );
}
