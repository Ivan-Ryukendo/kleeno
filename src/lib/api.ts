// Browser helper for our route handlers. Errors carry the support code (correlation ID) so users can quote it.
export interface ApiResult<T> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
}

/** GET (no body, never cached), or POST/PATCH with a JSON body. */
export async function requestJson<T = Record<string, unknown>>(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = method === "GET" ? await fetch(url, { cache: "no-store" }) : await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: json as T };
    const message = json?.error?.message ?? "Something went wrong";
    return { ok: false, status: res.status, error: json?.correlationId ? `${message} (support code ${json.correlationId})` : message };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

export function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<ApiResult<T>> {
  return requestJson<T>(url, "POST", body);
}
