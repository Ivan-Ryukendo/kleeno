"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CompanyProfile } from "@/core/company";
import { BasicsForm, ScheduleForm, type BasicsOptions } from "@/components/company-form";
import { MfaSetup } from "@/components/account-forms";
import { Button } from "@/components/ui/button";

const STEPS = ["Secure your account", "About your company", "Pay schedule"] as const;

// Three short screens (docs/pages.md #15). Everything can be changed later in Settings.
export function OnboardingWizard({ profile, options, mfaRequired, mfaOn }: { profile: CompanyProfile; options: BasicsOptions; mfaRequired: boolean; mfaOn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const canLeaveSecurity = mfaOn || !mfaRequired;

  return (
    <div className="mt-6">
      <ol className="flex items-center gap-3" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3" aria-current={i === step ? "step" : undefined}>
            <span className={`flex size-7 items-center justify-center rounded-chip border text-sm font-medium transition-colors duration-200 ${i <= step ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>{i + 1}</span>
            <span className={i === step ? "text-sm font-medium" : "hidden text-sm text-muted-foreground sm:inline"}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </li>
        ))}
      </ol>

      <section className="mt-6 panel">
        {step === 0 && (
          <>
            <h2 className="text-lg">Secure your account</h2>
            <p className="mt-2 text-muted-foreground">
              Payroll data is confidential. {mfaRequired ? "A second sign-in step is required for your company." : "A second sign-in step is optional here, and recommended."}
            </p>
            {mfaOn ? <p className="mt-6 font-medium">Two-step sign-in is on.</p> : <MfaSetup />}
            <div className="mt-8 flex gap-3">
              <Button type="button" disabled={!canLeaveSecurity} onClick={() => setStep(1)} className="h-9 rounded-field px-4 text-sm">
                Continue
              </Button>
            </div>
            {!canLeaveSecurity && <p className="mt-3 text-sm text-muted-foreground">Set it up above to continue.</p>}
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mb-4 text-lg">About your company</h2>
            <BasicsForm profile={profile} options={options} submitLabel="Save and continue" onSaved={() => setStep(2)} />
            <button type="button" className="mt-6 text-sm underline underline-offset-4" onClick={() => setStep(0)}>
              Back
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="mb-4 text-lg">Pay schedule</h2>
            <ScheduleForm profile={profile} submitLabel="Finish setup" onSaved={() => { router.push("/dashboard"); router.refresh(); }} />
            <button type="button" className="mt-6 text-sm underline underline-offset-4" onClick={() => setStep(1)}>
              Back
            </button>
          </>
        )}
      </section>
    </div>
  );
}
