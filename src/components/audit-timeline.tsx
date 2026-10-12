import Link from "next/link";
import { Bot, UserRound, ShieldCheck } from "lucide-react";
import type { AuditItem } from "@/server/db/audit";

export function AuditTimeline({ items, empty = "No recorded activity yet." }: { items: AuditItem[]; empty?: string }) {
  if (!items.length) return <p className="py-4 text-muted-foreground">{empty}</p>;
  return <ol aria-label="Recorded activity, newest first" className="mt-5 divide-y divide-border">
    {items.map((item) => <li key={item.id} className="relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 py-4">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full border bg-sidebar text-muted-foreground">{item.actorType === "ai" ? <Bot className="size-4" /> : item.actorType === "human" ? <UserRound className="size-4" /> : <ShieldCheck className="size-4" />}</span><div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {item.href ? <Link className="break-words font-medium underline underline-offset-4" href={item.href}>{item.event.replaceAll("_", " ").replaceAll(".", " · ")}</Link> : <p className="break-words font-medium">{item.event.replaceAll("_", " ").replaceAll(".", " · ")}</p>}
        <time className="text-xs text-muted-foreground" dateTime={item.at}>{new Date(item.at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.actorType === "ai" ? "Suggested by AI, not applied" : `Recorded by ${item.actorType}`}</p>
      <details className="mt-2 text-xs">
        <summary className="flex min-h-11 w-fit cursor-pointer items-center text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">Evidence and trace references</summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Event</dt><dd className="break-all font-mono">{item.id}</dd>
          <dt className="text-muted-foreground">Entity</dt><dd className="break-all font-mono">{item.entityType} {item.entityId}</dd>
          <dt className="text-muted-foreground">Actor reference</dt><dd className="break-all font-mono">{item.actor}</dd>
          <dt className="text-muted-foreground">Request trace</dt><dd className="break-all font-mono">{item.correlationId ?? "Not recorded"}</dd>
          {Object.entries(item.refs).map(([key, value]) => <div key={key} className="contents"><dt className="text-muted-foreground">{key}</dt><dd className="break-all font-mono">{value}</dd></div>)}
        </dl>
      </details>
      </div>
    </li>)}
  </ol>;
}
