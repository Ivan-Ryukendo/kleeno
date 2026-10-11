import Link from "next/link";
import { FileText, Lock, Scale, Sparkles, User } from "lucide-react";
import type { ReactNode } from "react";
import type { AuditItem } from "@/server/db/audit";
import { cn } from "@/lib/utils";
import { Chip, LinkButton, Panel } from "./ui";

export interface Todo { reason: string; href: string; beforeCutoff: boolean }

export function TodoPanel({ todos, roleText, cutoff }: { todos: Todo[]; roleText: string; cutoff: ReactNode | null }) {
  return (
    <Panel id="todo-h" title="My to-dos" chip={todos.length ? <Chip>{todos.length}</Chip> : undefined} aside={roleText}>
      {todos.length === 0
        ? <p className="px-4 py-4 text-muted-foreground">No action is waiting for your roles in this period.</p>
        : <ol className="m-0 list-none divide-y p-0">
          {todos.map((t, i) => (
            <li key={t.href + t.reason} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-2.5">
              <span aria-hidden className="mt-px grid size-[22px] flex-none place-items-center rounded-full border text-[0.6875rem] font-semibold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1 basis-56">
                <p className="m-0 font-medium">{t.reason}</p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><User aria-hidden className="size-3.5" />Your role: {roleText}{t.beforeCutoff && cutoff && <> · before <span className="tabular-nums">{cutoff}</span></>}</p>
              </div>
              <LinkButton href={t.href} className="max-sm:ml-[34px]">Open</LinkButton>
            </li>
          ))}
        </ol>}
    </Panel>
  );
}

const iconFor = (item: AuditItem) => item.actorType === "ai" ? Sparkles : /hold|reject|fail|exception/.test(item.event) ? Lock : /reconcil/.test(item.event) ? Scale : FileText;

export function ActivityPanel({ items, unavailable, truncated, viewAllHref }: { items: AuditItem[]; unavailable: boolean; truncated: boolean; viewAllHref: string }) {
  return (
    <Panel id="act-h" title="Recent activity" inlineAside aside={<Link href={viewAllHref} className="inline-flex min-h-11 items-center rounded-field px-2 text-[0.8125rem] font-medium text-foreground hover:bg-accent sm:min-h-8">View all</Link>}>
      {unavailable
        ? <p role="alert" className="px-4 py-3 text-sm text-signal">Activity unavailable. Recorded activity could not be loaded; no empty history can be inferred. Retry after checking database readiness.</p>
        : items.length === 0
          ? <p className="px-4 py-4 text-muted-foreground">No recorded activity yet.</p>
          : <ul className="m-0 list-none divide-y p-0">
            {items.slice(0, 6).map((item) => {
              const Icon = iconFor(item);
              const risky = Icon === Lock;
              return (
                <li key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className={cn("grid size-[26px] flex-none place-items-center rounded-full border bg-secondary text-muted-foreground", risky && "border-transparent bg-signal/10 text-signal")}><Icon aria-hidden className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 font-medium break-words">{item.href ? <Link className="underline underline-offset-4" href={item.href}>{label(item)}</Link> : label(item)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {item.actorType === "ai" ? <Chip>Suggested by AI, not applied</Chip> : <span>Recorded by {item.actorType}</span>}
                      <span aria-hidden>·</span>
                      <time dateTime={item.at}>{new Date(item.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>}
      {truncated && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">Some older entity links exceed this view&apos;s limit. Open the company audit timeline for full history.</p>}
    </Panel>
  );
}
const label = (item: AuditItem) => item.event.replaceAll("_", " ").replaceAll(".", " · ");
