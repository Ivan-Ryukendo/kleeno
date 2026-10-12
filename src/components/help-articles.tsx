"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

export interface HelpArticle { title: string; text: string; href: string; topic: string }

/** Search over the built-in guide steps. There is no article library yet, so this filters static copy shipped with the app. */
export function HelpArticles({ articles, suggestions }: { articles: HelpArticle[]; suggestions: string[] }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? articles.filter((a) => `${a.title} ${a.text} ${a.topic}`.toLowerCase().includes(q)) : articles;
  return (
    <div>
      <form role="search" className="relative max-w-2xl" onSubmit={(e) => e.preventDefault()}>
        <label className="sr-only" htmlFor={`${id}-q`}>Search help guides</label>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the guide, for example: exception, approve, import"
          autoComplete="off"
          className="h-10 w-full rounded-field border border-field-border bg-white pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/40 max-sm:h-11 max-sm:text-base"
        />
      </form>
      <p className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted-foreground">
        Try:
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => setQuery(s)} className="inline-flex min-h-8 items-center rounded-field px-1.5 underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-sm:min-h-11">{s}</button>
        ))}
      </p>
      <h2 className="mt-6 mb-2.5 text-base font-medium tracking-tight">Guide</h2>
      <p className="mb-3 text-xs text-muted-foreground">Built-in guide, shown as written in this release. It is not a searchable article library.</p>
      {shown.length === 0 ? (
        <p role="status" className="rounded-card border border-border px-4 py-6 text-sm text-muted-foreground">No guide step matches &ldquo;{query}&rdquo;. Ask the team below.</p>
      ) : (
        <ul className="m-0 grid list-none gap-4 p-0 min-[900px]:grid-cols-2">
          {shown.map((a) => (
            <li key={a.title} className="min-w-0">
              <Link href={a.href} className="group flex h-full min-w-0 gap-3 rounded-card border border-border bg-card p-4 transition-colors duration-150 hover:border-field-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">{a.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{a.text}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{a.topic}</p>
                </div>
                <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
