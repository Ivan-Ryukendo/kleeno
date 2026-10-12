import { HelpArticles, type HelpArticle } from "@/components/help-articles";
import { CSV_LIMITS } from "@/core/ingest/csv";
import { POLICY_LIMITS } from "@/core/ingest/documents";

const steps: HelpArticle[] = [
  { title: "1. Prepare the policy", topic: "Pay policy", href: "/configuration", text: "Review extracted clauses and supported rules, then approve the configuration. Missing policy facts require a human decision." },
  { title: "2. Import the period", topic: "Import", href: "/import", text: "Choose the company and period, inspect the mapping, and import anonymised CSV or XLSX evidence in USD. Names stay in your local name key; do not upload it." },
  { title: "3. Resolve exceptions", topic: "Exceptions", href: "/exceptions", text: "Review the source evidence and record a permitted resolution. Open or escalated exceptions block calculation; an AI suggestion is not a decision." },
  { title: "4. Inspect the calculation", topic: "Calculation", href: "/dashboard#pay-runs", text: "Check readiness, missing settings, exact totals and amount traces. Select a comparable prior run for historical differences; no baseline means no historical claim." },
  { title: "5. Record a fresh review", topic: "Approvals", href: "/dashboard#pay-runs", text: "An HR or payroll reviewer signs off the immutable calculation. Review sign-off is separate from payroll approval and payment authorization." },
  { title: "6. Track the handoff", topic: "Handoff", href: "/dashboard#pay-runs", text: "Generate the versioned CSV and evidence pack, keep the exported version, and record an evidence-backed acknowledgement. Manual acknowledgement is not settlement. Import actual-paid evidence to investigate differences." },
];

export function ReviewHelp() {
  return <section aria-labelledby="review-guide-heading">
    <h2 id="review-guide-heading" className="sr-only">Review guide and supported limits</h2>
    <HelpArticles articles={steps} suggestions={["exception", "approve", "import", "calculation"]} />
    <details className="mt-5 rounded-card border border-border px-4 py-3">
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
