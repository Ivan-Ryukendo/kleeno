# Notifications (Later)

Slack, Microsoft Teams, email. Capability `NOTIFICATION_SEND`. Port `Notifier`.

- Minimal content plus a link into Kleeno, where login, MFA and roles apply. Example: "Payroll run 2026-09 needs review: 3 exceptions. Open in Kleeno."
- Never in a notification: amounts, salaries, bank details, wallet addresses, worker names or codes, tax data, calculation detail, receipt links, policy text.
- Allowed fields: run label, count of items, action needed, state name, link. A future richer format needs its own security review and user approval.
- Links carry no tokens; the page authenticates.
- Notifications are one-way. Buttons that approve, sign or release from Slack/Teams are not allowed; actions happen in Kleeno with re-auth (rule 47).
- Sent notifications are audited (event type, channel, run ID), never with the message body's secrets (there are none).
