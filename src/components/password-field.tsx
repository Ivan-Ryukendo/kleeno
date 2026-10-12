"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Input, Label } from "@/components/ui/input";

/** A password input with a Show/Hide control (mockups/login.html `.pw`). Typing, paste and password managers behave as for a plain input. */
export function PasswordField({ id, name, label, labelRight, autoComplete, minLength, maxLength, describedBy, value, onChange, autoFocus }: { id: string; name: string; label: string; labelRight?: ReactNode; autoComplete: string; minLength?: number; maxLength?: number; describedBy?: string; value?: string; onChange?: (value: string) => void; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className="mb-0 text-[13px]">{label}</Label>
        {labelRight}
      </div>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={maxLength}
          aria-describedby={describedBy}
          required
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          className="h-9.5 pr-[4.5rem] max-[520px]:text-base"
          {...(onChange ? { value: value ?? "", onChange: (e) => onChange(e.target.value) } : {})}
        />
        <button
          type="button"
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((v) => !v)}
          className="absolute top-px right-px bottom-px inline-flex min-h-9 items-center gap-1.5 rounded-chip px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          {shown ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}
          {shown ? "Hide" : "Show"}
          <span className="sr-only"> password</span>
        </button>
      </div>
    </div>
  );
}
