// Browser helper for our route handlers. Errors carry the support code (correlation ID) so users can quote it.
export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json as T };
    const message = json?.error?.message ?? "Something went wrong";
    return { ok: false, error: json?.correlationId ? `${message} (support code ${json.correlationId})` : message };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}
