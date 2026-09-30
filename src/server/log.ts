import "server-only";

// Redacting logger (S45). Never log raw SDK errors, secrets or payroll values: only a scope,
// an event name, and an error's class + short code.
function safeError(err: unknown): string {
  if (!(err instanceof Error)) return "non-error";
  const code = (err as { code?: unknown }).code;
  return `${err.name}${typeof code === "string" || typeof code === "number" ? `:${code}` : ""}`;
}

export function logEvent(scope: string, event: string, refs: Record<string, string | number | boolean> = {}) {
  console.log(JSON.stringify({ scope, event, ...refs }));
}

export function logError(scope: string, event: string, err: unknown) {
  console.error(JSON.stringify({ scope, event, error: safeError(err) }));
}
