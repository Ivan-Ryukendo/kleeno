"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES, ROLE_LABELS, isAuthorityRole, type Role } from "@/core/tenancy";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <fieldset className="grid gap-2 sm:grid-cols-2" disabled={disabled}>
      <legend className="sr-only">Roles</legend>
      {ROLES.map((r) => (
        <label key={r} className="flex cursor-pointer items-start gap-2 rounded-field border border-border bg-white px-2.5 py-2 has-[:checked]:border-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary">
          <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          <span>
            <span className="block text-sm font-medium">{ROLE_LABELS[r]}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_HINTS[r]}</span>
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

const rowButton = "inline-flex h-7 whitespace-nowrap items-center gap-1 rounded-field border border-border bg-background px-2 text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 max-[700px]:min-h-11 max-[700px]:px-3 max-[700px]:text-sm";

export function RevokeInviteButton({ id, email }: { id: string; email?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={`${rowButton} text-signal hover:bg-signal/10`}
      onClick={async () => {
        setBusy(true);
        await postJson(`/api/invites/${id}/revoke`);
        router.refresh();
        setBusy(false);
      }}
    >
      Revoke<span className="sr-only"> invite{email ? ` for ${email}` : ""}</span>
    </button>
  );
}

/** One member's actions: change roles (a dialog) or remove. Nobody edits their own row; the server also refuses it. */
export function MemberActions({ userId, roles, isSelf, lastOwner = false, label }: { userId: string; roles: Role[]; isSelf: boolean; lastOwner?: boolean; label?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState<Role[]>(roles);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const widens = next.some((r) => isAuthorityRole(r) && !roles.includes(r));
  const close = () => { setEditing(false); setNext(roles); setPassword(""); setError(null); };

  if (isSelf) return <span className="text-sm text-muted-foreground">You</span>;
  return (
    <>
      <span className="flex flex-wrap justify-end gap-1">
        <button type="button" className={rowButton} onClick={() => setEditing(true)}>
          Change roles<span className="sr-only">{label ? ` for ${label}` : ""}</span>
        </button>
        {lastOwner ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title="The last Owner can't be removed"><Lock aria-hidden="true" className="size-3" />Last Owner</span>
        ) : (
          <button
            type="button"
            className={`${rowButton} text-signal hover:bg-signal/10`}
            onClick={async () => {
              if (!confirm("Remove this person? They lose access at their next click.")) return;
              const r = await postJson(`/api/team/${userId}`, { action: "remove" });
              if (!r.ok) alert(r.error ?? "Could not remove");
              router.refresh();
            }}
          >
            Remove<span className="sr-only">{label ? ` ${label}` : ""}</span>
          </button>
        )}
      </span>
      <Dialog open={editing} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Change roles{label ? `: ${label}` : ""}</DialogTitle>
            <DialogDescription>A member can hold several roles. Roles apply to this company only.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
              <Button type="button" variant="outline" className="h-9 rounded-field px-4 text-sm" onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
