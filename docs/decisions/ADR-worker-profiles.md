# ADR: Worker profiles, leave, change requests and reminders

Status: **concept** (user request 2026-10-01). User plan: conceptualize now; build a small, working slice for the hackathon only if time allows after P3; full build after the hackathon.

## October 6 future-product update (planned, not active)

The owner approved documenting company opt-in encrypted **employee names and basic contact details** as a future direction, default off for existing companies. This is the narrowed first profile slice in [roadmap Step 8](../roadmap.md#step-8--introduce-employee-profiles-and-self-service), not permission to store names now. Current rule 35/S25 and browser-only name handling remain active until the encryption, access, deletion and migration controls pass and active rules are amended together.

This update supersedes conflicting recommendations in the earlier concept below:

- Initial access default: HR plus employees viewing only their own published records, with explicit employee-account mapping and MFA for all real-data users. The earlier optional-worker-MFA proposal is superseded. Broader manager access is deferred.
- Name/basic contact fields are encrypted through existing company-key repositories; keep them out of AI inputs, chain, logs and audit payloads. Opt-in must be explicit; real-data retention/deletion/export and backup behavior must be specified before rollout.
- Schedules (regular/irregular, timezone), projects/allocation/blockers, applicable policies and supported performance measures are future profile capabilities. Show source/period/target/freshness/missing data and role/leave/workload context; never automate punitive employment decisions.
- Corrections are reviewed requests. Employees cannot directly change approved pay, policy or payout recipients; original approved records stay immutable. Reuse existing guarded compensation/recipient paths.
- Photos, general documents, unrestricted notes and medical records are outside this initial exception. Earlier upload/storage proposals below are historical options, not approved near-term scope or launch dates.
- Existing company-configured resource leave/KPI work and P4c proration have their current status in PROGRESS; the older statement that all leave/proration is deferred does not describe the present implementation.
- No new WORKER role, profile schema, storage bucket or UI is implemented by this documentation update. Define the narrow role/access contract and tests in the selected phase before coding. Profile controls are planned in [security section 7](../security.md#7-future-commercial-controls-2026-10-06-all-planned).

## Earlier October 1 concept (historical; narrowed above)

## Request
Each worker gets a personal page: HR uploads details and documents, workers upload their own photo and information, everything linked to that page. It shows status, leave balance and what a long-term leave needs. The dashboard shows worker information updates for HR to approve, and sends reminders to HR and the team about upcoming leave.

## Conflicts with the current rules
1. **Rule 35 / S25 ("names never reach the server").** Workers are W001-style codes on purpose. A profile with name, contact, photo or documents is personal data on the server. This ADR proposes an **opt-in per company** exception (below). Without approval, profile data stays out and only pseudonymous fields exist.
2. **Workers are not users.** Only approvers have accounts (`memberships`, rule 33). Workers uploading their own data needs a new `WORKER` role that sees only its own page.
3. **Scope and time.** The original time-pressure assessment predates the extension. Submission is now **October 17, 2026** (user update 2026-10-05); current phase status and dependency-aware dates are in PROGRESS and PRD §12. Leave balances, notifications and wider RBAC remain out of scope; the extension prioritizes validation/evidence/demo, not expansion of this ADR.

## Decisions proposed
**Data kinds.**
- *Payroll data* (today): pseudonymous, pay encrypted (S41).
- *Profile data* (new): display name, contact, photo, notes, documents. Stored only when the company opts in, encrypted with the company key (S41, same AAD binding); never sent to AI, chain, logs or audit refs. Rule 35 is amended to: "names never reach AI, the chain, logs or audit; they may be stored encrypted when a company opts in."
- *Medical documents:* **not stored.** A long-term leave record keeps type, dates, expected return, "documentation received: yes/no" and who checked it. This avoids holding health data.

**Files (photos, documents).** Private Supabase Storage bucket, path `company/worker/uuid`, ciphertext only (company key), served through an authenticated route with short-lived access and `no-store`. Limits: images JPEG/PNG/WebP ≤ 2 MB, documents PDF ≤ 5 MB; magic-byte check; images re-encoded to strip EXIF; one audit event per upload and per view of a document. Malware scanning deferred (listed in `docs/security.md` §4).

**Worker access.** `WORKER` role, invited by HR, login with email + password (MFA optional for workers). Reads only its own page; every write is a *change request*, never a direct update (rule 33: identity comes from the session).

**Change requests (the approval step).** New state machine `change_request`: SUBMITTED -> APPROVED | REJECTED | WITHDRAWN, compare-and-set like the others (rule 48 pattern). Approving applies the change on the server and writes one audit event. Reviewers: HR/payroll approver, never the requester. Field classes:
- *Low risk* (display name, phone, address, photo, emergency contact): HR approves, applied.
- *Pay-affecting* (compensation, pay type): not requestable by workers; stays the existing HR "Change pay" path.
- *Payout wallet:* never changeable by a worker request. It routes through the P4 recipient-change confirmation with re-authentication (S16, rule 47). A wallet change request is the classic payment-redirection fraud.

**Leave.**
- *Ledger:* append-only `leave_entries` (ACCRUAL, TAKEN, ADJUSTMENT) with a reason; the balance is derived, never edited. Informational in the MVP: it does not auto-deduct pay. The engine keeps using the approved leave days from the reconciled import (P3).
- *Leave periods:* planned or approved leave with type, dates, expected return, and for long-term leave a handover checklist (cover person, access, payroll treatment, return date, documentation received).
- *Pay while on leave* (paid, unpaid, partial) is an input to the engine; mid-period join/leave proration stays post-hackathon.

**Reminders.**
- In-app first: a dashboard "Upcoming leave and pending approvals" panel, computed on page load (no scheduler).
- Email or chat later via a `notification` capability (`docs/integrations/`), counts and links only, never pay data (ARCHITECTURE §24). Needs a scheduled job (Vercel Cron) and a sender; post-hackathon.

**Table views.** The worker list and profile tabs use the dynamic table view in `docs/pages.md` §5.

## Recommended placement
| When | What |
|---|---|
| Hackathon, only if time allows after P3 (cuttable) | HR-only `/workers/[id]` page: status, pay history, leave periods and ledger entered by HR, notes; in-app dashboard panel for upcoming leave. Pseudonymous only; no new role, no files, no profile PII. |
| Right after the hackathon | Company opt-in profile data, `WORKER` role and invites, change requests with HR approval, photo and document upload, email/chat reminders. |
Why: the demo story is "AI proposes, humans approve, Kleeno pays"; worker self-service and file storage add a new role, a new attack surface and personal data, and should arrive with the pilot's consent and data-handling note (`docs/traction.md`).

## Security rows to add when built
Profile fields encrypted and absent from plaintext columns; WORKER can read only its own rows (RLS) and cannot write directly; file type/size limits, EXIF stripped, no public bucket, signed access expires; change-request CAS and requester != approver; wallet change cannot bypass re-auth; reminders contain no pay data; every upload, view and approval audited.
