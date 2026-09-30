# ADR: Kleeno MCP server

Status: accepted as design; build deferred to Next (user, 2026-09-30).

## Context
Customers' AI assistants and agents should be able to ask Kleeno about runs, exceptions, traces and payments. MCP is the standard interface for that. Payroll is confidential and payment-bearing, so exposure must be minimal and never grant authority.

## Decision
1. **Read-only first.** Tools and controls in `docs/integrations/mcp.md`. No write, approval, resolution, obligation, recipient, config, authorization or payment tool exists. Adding any write tool needs a new ADR and user approval, and could only ever *propose* (like the AI agents), never approve or pay.
2. **One identity system.** The MCP server is an OAuth 2.1 resource server (MCP authorization spec); Supabase Auth's OAuth 2.1 server issues tokens. Roles still come from `app_users`; MFA still applies.
3. **Same authorization path** as route handlers: auth guard, company from `app_users`, object-level checks, rate limits, one audit event per call.
4. **Annotations are hints.** Tools declare `readOnlyHint: true` etc., but security never depends on them.
5. **Facts come from Kleeno.** Explanations are built from stored traces, rule IDs and evidence IDs; an external LLM can only rephrase them.
6. **Per-company opt-in**, off by default.
7. **Kleeno does not consume MCP in its own agents.** Connectors to external systems (even ones offering MCP, like BambooHR) are deterministic server code whose output goes through normalization and `src/core/ai/inputs/`.

## Why not during the hackathon
About a day of work (auth flow, tool handlers, tests) during the busiest week, and it isn't needed for the Track 4 workflow. The domain services it would call (runs, exceptions, trace, audit) are built in P1–P5 anyway, so adding MCP later is additive.

## Consequences
- Needs: `companies.mcp_enabled`, a Supabase OAuth 2.1 server setup, `src/server/mcp/`, `src/app/api/mcp/route.ts`, and a security row (S50) moved from `deferred` to a phase.
- Risk: data leaving to third-party LLM clients the customer chose. Mitigated by opt-in, minimal fields, worker codes only, role checks and audit.

## References
[MCP authorization spec](https://modelcontextprotocol.io/specification/latest/basic/authorization) · [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication) · MCP tool annotations are untrusted hints ([overview](https://aident.ai/blog/mcp-tool-annotations-explained)).
