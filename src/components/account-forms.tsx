"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { postJson } from "@/lib/api";

export function PasswordForm() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        const f = new FormData(form);
        const r = await postJson("/api/auth/password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") });
        setMsg(r.ok ? { ok: true, text: "Password changed." } : { ok: false, text: r.error ?? "Could not change the password" });
        if (r.ok) form.reset();
        setBusy(false);
      }}
    >
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </div>
      <div>
        <Label htmlFor="newPassword">New password (12 characters or more)</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm font-medium" : "text-sm font-medium text-signal"}>
          {msg.text}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-11 rounded-[1.25rem] px-6 text-base">
        Change password
      </Button>
    </form>
  );
}

export function MfaSetup() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!setup) {
    return (
      <div className="mt-6">
        <Button
          type="button"
          className="h-11 rounded-[1.25rem] px-6 text-base"
          onClick={async () => {
            const r = await postJson<{ factorId: string; qr: string; secret: string }>("/api/auth/mfa/enroll");
            if (r.ok && r.data) setSetup(r.data);
            else setError(r.error ?? "Could not start setup");
          }}
        >
          Set up an authenticator app
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-signal">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const r = await postJson("/api/auth/mfa/verify", { factorId: setup.factorId, code: f.get("code") });
        if (r.ok) router.refresh();
        else setError(r.error ?? "That code is not valid");
      }}
    >
      <p className="text-muted-foreground">Scan this code with an authenticator app, then enter the 6-digit code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase Auth */}
      <img src={setup.qr} alt="Authenticator QR code" className="size-44 rounded-[1.25rem] bg-white p-3" />
      <p className="break-all text-sm text-muted-foreground">
        Or enter this key by hand: <span className="font-mono">{setup.secret}</span>
      </p>
      <div>
        <Label htmlFor="code">6-digit code</Label>
        <Input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required />
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-signal">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11 rounded-[1.25rem] px-6 text-base">
        Turn on MFA
      </Button>
    </form>
  );
}
