import Link from "next/link";
import type { ReactNode } from "react";
import { settingsNav } from "@/components/shell/nav-config";
import type { Role } from "@/core/tenancy";

/**
 * Settings frame (mockups/settings-company.html `.set`): grouped section links beside the page body, shared by /settings/*,
 * /configuration and /account. Links follow the existing visibility rules; each destination still checks access.
 * Below 1024px the sections become one scrollable row above the body (44px touch targets).
 */
export function SettingsNavigation({ roles, current, nav = true, children }: { roles: readonly Role[]; current: string; nav?: boolean; children: ReactNode }) {
  if (!nav) return <>{children}</>;
  return (
    <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <nav aria-label="Settings sections" className="flex min-w-0 gap-0.5 overflow-x-auto border-b border-border pb-2 [scrollbar-width:none] lg:sticky lg:top-16 lg:flex-col lg:overflow-visible lg:border-b-0 lg:pb-0">
        {settingsNav(roles).map((group, index) => (
          <div key={group.id} className="contents">
            <span className={`hidden px-2 pb-1 text-xs font-medium text-muted-foreground lg:block ${index > 0 ? "lg:mt-3.5" : ""}`} aria-hidden="true">
              {group.label}
            </span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current === item.href ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-field px-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:min-h-8 ${current === item.href ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 [&>:first-child]:mt-0">{children}</div>
    </div>
  );
}
