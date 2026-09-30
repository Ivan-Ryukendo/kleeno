# Kleeno MCP Server (Next, read-only)

Lets a user's own AI assistant (Claude, ChatGPT, Copilot, an agent framework) ask Kleeno about payroll. Decision: `docs/decisions/ADR-kleeno-mcp.md`. Built after the hackathon; nothing here is in the MVP.

## Tools (all read-only)
| Tool | Returns |
|---|---|
| `list_payroll_runs` | run IDs, period, mode, state, counts |
| `get_payroll_run` | one run: state, exception count, calculation status, approval state |
| `list_exceptions` / `get_exception` | type, state, evidence IDs, stored AI suggestion (labelled as suggestion) |
| `get_calculation_trace` | trace lines for one worker code (W001…) of one run |
| `explain_payroll` | explanation built from the stored trace, rule IDs and evidence IDs |
| `get_variance_report` | SIMULATION variance findings |
| `get_pending_approvals` | what is waiting for the caller's role |
| `get_payment_status` | obligation/batch/payment states, tx hash |
| `get_audit_timeline` | audit events for one run (references only) |

**Absent by design** (no tool, no hidden flag): `approve_payroll`, `approve_exception`, `resolve_exception`, `create_obligation`, `change_salary`, `change_recipient`, `authorize_payment`, `open_payment_run`, `pay_obligation`, `change_payroll_config`, anything that writes. Adding a write tool needs a new ADR and user approval.

## Controls
- **Auth:** the MCP server is an OAuth 2.1 resource server per the MCP authorization spec (Protected Resource Metadata, RFC 9728). Supabase Auth's OAuth 2.1 server issues the tokens, so there is no second identity system ([MCP spec](https://modelcontextprotocol.io/specification/latest/basic/authorization), [Supabase](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)). Tokens are audience-bound to the Kleeno MCP resource; the server never passes a client token on to other APIs.
- **Same guard as the app:** the same auth guard as route handlers (`src/server/auth`): user from the token; company and role from `app_users`; MFA (`aal2`) required on MFA companies; reads through the same RLS-scoped access; object-level checks on every ID; cross-company IDs return "not found".
- **Opt-in:** off per company by default (`companies.mcp_enabled`); the payment approver or an admin turns it on. The demo company may enable it for judges' read-only exploration later.
- **Minimal data:** worker codes only, never names or wallet addresses. Amounts only in `get_calculation_trace`, `explain_payroll` and `get_variance_report`, and only for the roles that can see them in the UI. Policy text only if a tool explicitly needs it, returned as data.
- **Rate limits** per user and per company; bounded page sizes.
- **Audit:** every call writes one audit event (tool, caller, company, object IDs; never the response body).
- **Annotations:** every tool is marked `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. They are hints for clients only; authorization is enforced server-side regardless.
- **Explanations come from stored facts:** `explain_payroll` returns the deterministic trace, rule IDs and evidence IDs (plus an optional plain-language summary produced by Kleeno's validated explainer). An external LLM can phrase them but cannot supply the facts.
- Responses include `source: "kleeno"` and `as_of`.

## Response shape
```json
{ "run_id": "run_123", "status": "EXCEPTIONS_PENDING", "exception_count": 3,
  "calculation_status": "BLOCKED", "source": "kleeno", "as_of": "2026-10-01T12:00:00Z" }
```

## Placement (when built)
`src/server/mcp/` (tool handlers calling core read services), `src/app/api/mcp/route.ts` (Streamable HTTP endpoint). Check the current MCP spec and SDK before building.

## Tests (when built)
Read-only tools work; the tool list contains no mutation tool (snapshot test against the absent list); unauthenticated caller rejected; `aal1` caller on an MFA company rejected; cross-company ID rejected; no tool reaches the gate, rail, state setters or approval services (structure test); rate limit enforced; one audit event per call.
