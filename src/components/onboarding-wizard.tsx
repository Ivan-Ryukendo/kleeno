"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CompanyProfile } from "@/core/company";
import { BasicsForm, ScheduleForm } from "@/components/company-form";
import { MfaSetup } from "@/components/account-forms";
import { Button } from "@/components/ui/button";

const STEPS = ["Secure your account", "About your company", "Pay schedule"] as const;

// Three short screens (docs/pages.md #15). Everything can be changed later in Settings.
export function OnboardingWizard({ profile, mfaRequired, mfaOn }: { profile: CompanyProfile; mfaRequired: boolean; mfaOn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const canLeaveSecurity = mfaOn || !mfaRequired;

  return (
    <div className="mt-10">
      <ol className="flex items-center gap-3" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3" aria-current={i === step ? "step" : undefined}>
            <span className={`flex size-8 items-center justify-center rounded-full border text-sm font-medium transition-colors duration-200 ${i <= step ? "border-primary bg-primary text-primary-foreground" : "border-primary/40 bg-white"}`}>{i + 1}</span>
            <span className={i === step ? "text-sm font-medium" : "hidden text-sm text-muted-foreground sm:inline"}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-primary/30" />}
          </li>
        ))}
      </ol>

      <section className="mt-8 rounded-[2.5rem] bg-card p-10 shadow-card">
        {step === 0 && (
          <>
            <h2 className="text-2xl">Secure your account</h2>
            <p className="mt-2 text-muted-foreground">
              Payroll data is confidential. {mfaRequired ? "A second sign-in step is required for your company." : "A second sign-in step is optional here, and recommended."}
            </p>
            {mfaOn ? <p className="mt-6 font-medium">Two-step sign-in is on.</p> : <MfaSetup />}
            <div className="mt-8 flex gap-3">
              <Button type="button" disabled={!canLeaveSecurity} onClick={() => setStep(1)} className="h-11 rounded-[1.25rem] px-6 text-base">
                Continue
              </Button>
            </div>
            {!canLeaveSecurity && <p className="mt-3 text-sm text-muted-foreground">Set it up above to continue.</p>}
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="mb-6 text-2xl">About your company</h2>
            <BasicsForm profile={profile} submitLabel="Save and continue" onSaved={() => setStep(2)} />
            <button type="button" className="mt-6 text-sm underline underline-offset-4" onClick={() => setStep(0)}>
              Back
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="mb-6 text-2xl">Pay schedule</h2>
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
