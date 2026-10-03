"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES, ROLE_LABELS, isAuthorityRole, type Role } from "@/core/tenancy";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

const ROLE_HINTS: Record<Role, string> = {
  OWNER: "Company details, team and invites.",
  HR_APPROVER: "Pay policy, imports, exceptions and calculation.",
  PAYROLL_APPROVER: "Approves a payroll run.",
  PAYMENT_APPROVER: "Signs payments. Never the same person who approved the run.",
  VIEWER: "Can look, cannot change anything.",
};

function RolePicker({ value, onChange, disabled = false }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2" disabled={disabled}>
      <legend className="sr-only">Roles</legend>
      {ROLES.map((r) => (
        <label key={r} className="flex cursor-pointer items-start gap-3 rounded-box border border-border bg-white px-4 py-3 has-[:checked]:border-primary">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span>
            <span className="block text-sm font-medium">{ROLE_LABELS[r]}</span>
            <span className="block text-sm text-muted-foreground">{ROLE_HINTS[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const Alert = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="text-sm font-medium text-signal">
      {text}
    </p>
  ) : null;

/** Invite a person by email with roles. Payroll and payment roles ask for the Owner's password again (rule 47). */
export function InviteForm() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(["VIEWER"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ link: string; emailed: boolean; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          setBusy(true);
          setError(null);
          setCopied(false);
          const email = String(f.get("email"));
          const password = String(f.get("password") ?? "");
          const r = await postJson<{ link: string; emailed: boolean }>("/api/invites", { email, roles, ...(password ? { password } : {}) });
          if (!r.ok || !r.data) setError(r.error ?? "Could not create the invite");
          else {
            setIssued({ ...r.data, email });
            form.reset();
            setRoles(["VIEWER"]);
            router.refresh();
          }
          setBusy(false);
        }}
      >
        <div>
          <Label htmlFor="invite-email">Email address</Label>
          <Input id="invite-email" name="email" type="email" required maxLength={254} autoComplete="off" />
        </div>
        <RolePicker value={roles} onChange={setRoles} />
        {roles.some(isAuthorityRole) && (
          <div>
            <Label htmlFor="invite-password">Your password, to confirm</Label>
            <Input id="invite-password" name="password" type="password" autoComplete="current-password" required />
            <p className="mt-2 text-sm text-muted-foreground">Payroll and payment roles give real authority, so we ask for your password again.</p>
          </div>
        )}
        <Alert text={error} />
        <Button type="submit" disabled={busy || roles.length === 0} className="h-9 rounded-field px-4 text-sm">
          Create invite link
        </Button>
      </form>

      {issued && (
        <div className="mt-6 rounded-box border border-border bg-white p-5" role="status">
          <p className="text-sm font-medium">{issued.emailed ? `We emailed ${issued.email}. You can also share this link:` : `Share this link with ${issued.email}. It works once, for 7 days, only for that address.`}</p>
          <div className="mt-3 flex gap-3">
            <Input readOnly value={issued.link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-field px-4 text-sm"
              onClick={async () => {
                await navigator.clipboard.writeText(issued.link);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-sm underline underline-offset-4 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        await postJson(`/api/invites/${id}/revoke`);
        router.refresh();
        setBusy(false);
      }}
    >
      Revoke
    </button>
  );
}

/** One member row: change roles or remove. Nobody edits their own row; the server also refuses it. */
export function MemberActions({ userId, roles, isSelf }: { userId: string; roles: Role[]; isSelf: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState<Role[]>(roles);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const widens = next.some((r) => isAuthorityRole(r) && !roles.includes(r));

  if (isSelf) return <span className="text-sm text-muted-foreground">You</span>;
  if (!editing)
    return (
      <span className="flex gap-4">
        <button type="button" className="text-sm underline underline-offset-4" onClick={() => setEditing(true)}>
          Change roles
        </button>
        <button
          type="button"
          className="text-sm underline underline-offset-4"
          onClick={async () => {
            if (!confirm("Remove this person? They lose access at their next click.")) return;
            const r = await postJson(`/api/team/${userId}`, { action: "remove" });
            if (!r.ok) alert(r.error ?? "Could not remove");
            router.refresh();
          }}
        >
          Remove
        </button>
      </span>
    );

  return (
    <div className="mt-3 w-full space-y-4">
      <RolePicker value={next} onChange={setNext} />
      {widens && (
        <div>
          <Label htmlFor={`pw-${userId}`}>Your password, to confirm</Label>
          <Input id={`pw-${userId}`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
      )}
      <Alert text={error} />
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={busy || next.length === 0}
          className="h-9 rounded-field px-4 text-sm"
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await postJson(`/api/team/${userId}`, { action: "set_roles", roles: next, ...(password ? { password } : {}) });
            if (!r.ok) setError(r.error ?? "Could not save");
            else {
              setEditing(false);
              setPassword("");
              router.refresh();
            }
            setBusy(false);
          }}
        >
          Save roles
        </Button>
        <Button type="button" variant="outline" className="h-9 rounded-field px-4 text-sm" onClick={() => { setEditing(false); setNext(roles); setError(null); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
