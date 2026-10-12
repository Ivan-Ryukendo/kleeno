"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CompanyProfile } from "@/core/company";
import { BasicsForm, ScheduleForm, type BasicsOptions } from "@/components/company-form";
import { MfaSetup } from "@/components/account-forms";
import { Button } from "@/components/ui/button";

const STEPS = ["Secure account", "Company basics", "Pay schedule"] as const;

// Three short screens (docs/pages.md #15, mockups/onboarding.html). Everything can be changed later in Settings.
// Legal name, approval cutoff and a recovery-codes step have no backing data or flow, so they are not offered.
export function OnboardingWizard({ profile, options, mfaRequired, mfaOn }: { profile: CompanyProfile; options: BasicsOptions; mfaRequired: boolean; mfaOn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const canLeaveSecurity = mfaOn || !mfaRequired;
  const back = (to: number) => (
    <button type="button" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground" onClick={() => setStep(to)}>
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Back
    </button>
  );

  return (
    <section aria-label="Company setup" className="rounded-card border border-border bg-card p-7 max-[520px]:p-5">
      <ol className="m-0 mb-5 flex list-none items-center p-0" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`} aria-current={i === step ? "step" : undefined}>
            <span className={`flex items-center gap-2 text-xs font-medium ${i === step ? "text-foreground" : "text-muted-foreground"}`}>
              <span className={`grid size-6 place-items-center rounded-full border-2 text-[11px] font-semibold transition-colors duration-200 ${i < step ? "border-success bg-success text-white" : i === step ? "border-foreground bg-background text-foreground" : "border-border bg-background text-muted-foreground"}`}>
                {i < step ? <Check aria-hidden="true" className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="max-[520px]:sr-only">{label}</span>
              {i < step && <span className="sr-only">(done)</span>}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="mx-2 h-0.5 flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <h1 className="text-xl font-medium tracking-tight">Secure your account</h1>
          <p className="mt-1.5 text-muted-foreground">
            Payroll data is confidential. {mfaRequired ? "A second sign-in step is required for your company." : "A second sign-in step is optional here, and recommended."}
          </p>
          {mfaOn ? <p className="mt-5 font-medium">Two-step sign-in is on.</p> : <MfaSetup />}
          <div className="mt-6 flex gap-3">
            <Button type="button" disabled={!canLeaveSecurity} onClick={() => setStep(1)} className="ml-auto h-9.5 min-h-11 rounded-field px-4 text-sm">
              Continue
              <ArrowRight aria-hidden="true" className="ml-1.5 size-3.5" />
            </Button>
          </div>
          {!canLeaveSecurity && <p className="mt-3 text-sm text-muted-foreground">Set it up above to continue.</p>}
        </>
      )}
      {step === 1 && (
        <>
          <h1 className="text-xl font-medium tracking-tight">Company basics</h1>
          <p className="mt-1.5 mb-5 text-muted-foreground">Shown to your team. You can change these later in Settings.</p>
          <BasicsForm profile={profile} options={options} submitLabel="Save and continue" onSaved={() => setStep(2)} />
          {back(0)}
        </>
      )}
      {step === 2 && (
        <>
          <h1 className="text-xl font-medium tracking-tight">Pay schedule</h1>
          <p className="mt-1.5 mb-5 text-muted-foreground">How often you pay workers. Each period becomes one payroll run to review. New companies start in SIMULATION, which never pays.</p>
          <ScheduleForm profile={profile} submitLabel="Finish setup" onSaved={() => { router.push("/dashboard"); router.refresh(); }} />
          {back(1)}
        </>
      )}
    </section>
  );
}
