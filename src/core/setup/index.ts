// The dashboard setup checklist (P3b): computed from data, never stored, so it cannot drift from what actually exists.
export interface SetupFacts {
  teamInvited: boolean; // another member or a pending invite exists
  workers: number;
  policyApproved: boolean; // an approved or active configuration exists
  runs: number;
}

export interface SetupItem {
  id: "team" | "workers" | "policy" | "run";
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

export function setupChecklist(f: SetupFacts): { items: SetupItem[]; done: number; total: number; next: SetupItem | null } {
  const items: SetupItem[] = [
    { id: "team", label: "Invite your team", hint: "People who approve payroll and payments sign in with their own account.", href: "/settings/team", done: f.teamInvited },
    { id: "workers", label: "Add your workers", hint: "The people you pay, by code. Names stay in your browser.", href: "/workers", done: f.workers > 0 },
    { id: "policy", label: "Approve your pay policy", hint: "Paste your policy; AI proposes the rules and you approve them.", href: "/configuration", done: f.policyApproved },
    { id: "run", label: "Run your first payroll", hint: "A simulation first: nothing is paid.", href: "/dashboard#start-run", done: f.runs > 0 },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, next: items.find((i) => !i.done) ?? null };
}
