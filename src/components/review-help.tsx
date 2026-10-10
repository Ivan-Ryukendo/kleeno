import Link from "next/link";
import { CSV_LIMITS } from "@/core/ingest/csv";
import { POLICY_LIMITS } from "@/core/ingest/documents";

const steps = [
  { title: "Prepare the policy", href: "/configuration", text: "Review extracted clauses and supported rules, then approve the configuration. Missing policy facts require a human decision." },
  { title: "Import the period", href: "/import", text: "Choose the company and period, inspect the mapping, and import anonymised CSV or XLSX evidence in USD. Names stay in your local name key; do not upload it." },
  { title: "Resolve exceptions", href: "/exceptions", text: "Review the source evidence and record a permitted resolution. Open or escalated exceptions block calculation; an AI suggestion is not a decision." },
  { title: "Inspect the calculation", href: "/dashboard#pay-runs", text: "Check readiness, missing settings, exact totals and amount traces. Select a comparable prior run for historical differences; no baseline means no historical claim." },
  { title: "Record a fresh review", href: "/dashboard#pay-runs", text: "An HR or payroll reviewer signs off the immutable calculation. Review sign-off is separate from payroll approval and payment authorization." },
  { title: "Track the handoff", href: "/dashboard#pay-runs", text: "Generate the versioned CSV and evidence pack, keep the exported version, and record an evidence-backed acknowledgement. Manual acknowledgement is not settlement. Import actual-paid evidence to investigate differences." },
];

export function ReviewHelp() {
  return <section className="mt-6 panel" aria-labelledby="review-guide-heading">
    <h2 id="review-guide-heading" className="text-lg">Review guide and supported limits</h2>
    <ol className="mt-4 grid gap-5 md:grid-cols-2">
      {steps.map((step, index) => <li key={step.title} className="min-w-0">
        <h3 className="font-medium">{index + 1}. {step.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
        <Link href={step.href} className="mt-2 inline-flex min-h-10 items-center text-sm underline underline-offset-4">Open {step.title.toLowerCase()}</Link>
      </li>)}
    </ol>
    <details className="mt-5 border-t pt-4">
      <summary className="min-h-10 cursor-pointer text-sm font-medium">File limits and unavailable workflows</summary>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">
        <p>CSV and XLSX: up to {CSV_LIMITS.bytes / 1024 / 1024} MB, {CSV_LIMITS.rows.toLocaleString("en-US")} rows and {CSV_LIMITS.columns} columns. Macro-enabled and legacy Excel files are unsupported.</p>
        <p>Policy uploads: TXT, MD, DOCX and text PDFs; up to {POLICY_LIMITS.fileBytes / 1024 / 1024} MB per file, {POLICY_LIMITS.files} files and {POLICY_LIMITS.batchBytes / 1024 / 1024} MB total. Scans need OCR; protected or unsafe documents are rejected. Original documents are not stored.</p>
        <p>SIMULATION cannot pay. Worker payments use Arc testnet only and require separate permissions and independently verified receipts. The review workspace does not provide production wage payment or statutory tax filing.</p>
        <p>For help, include the affected step and safe evidence references in a request below. Do not share names, passwords, keys, wallet recovery files or raw payroll files. Support response and recovery targets are not configured.</p>
      </div>
    </details>
  </section>;
}
