import { createHash } from "node:crypto";

// Canonical JSON (sorted keys, bigint as string) so equal inputs always hash equally (rule 9).
function canon(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canon(v)]),
    );
  }
  return value;
}

export const canonicalString = (value: unknown): string => JSON.stringify(canon(value));

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}
