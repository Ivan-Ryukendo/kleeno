# Identity (Later)

Google Workspace, Microsoft Entra ID, Okta: single sign-on through Supabase Auth (SAML/OIDC), so there is still one identity system.

- External identity **authenticates** the user. `app_users` in Kleeno stays the only source of Kleeno roles (`HR_APPROVER`, `PAYMENT_APPROVER`) and company membership (rule 33). IdP group claims never grant a role automatically.
- Users are still provisioned by an admin (no self sign-up via SSO). An SSO login with no `app_users` row gets no access.
- MFA: accept the IdP's MFA only if Supabase reports `aal2`; otherwise Kleeno's TOTP (S43) still applies.
- Re-auth for authority-granting actions (rule 47) still happens in Kleeno. With SSO-only users this needs a fresh IdP login (max age) instead of a password: decide before enabling SSO for approvers.
- Four-eyes stays in the database: two IdP accounts still count as two users only if they are two `app_users` rows (accepted risk in `docs/security.md` §5 is unchanged).
