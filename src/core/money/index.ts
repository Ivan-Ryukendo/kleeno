// Money is integer micro-USDC (6 dp) as bigint. No floats anywhere (rule 7).
export type MicroUsdc = bigint;

const MICRO = 1_000_000n;
const CENT = 10_000n;

export function parseUsdc(text: string): MicroUsdc {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) throw new Error("invalid USDC amount");
  return BigInt(m[1]) * MICRO + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** "12.34" style (2 dp minimum, up to 6 when sub-cent precision exists). */
export function formatUsdc(value: MicroUsdc): string {
  if (value < 0n) return `-${formatUsdc(-value)}`;
  const frac = (value % MICRO).toString().padStart(6, "0").replace(/0{1,4}$/, "");
  return `${value / MICRO}.${frac.padEnd(2, "0")}`;
}

/** Each line is rounded half-up to 0.01 (rule 8). */
export function roundHalfUpToCent(value: MicroUsdc): MicroUsdc {
  if (value < 0n) throw new Error("negative amount");
  return ((value + CENT / 2n) / CENT) * CENT;
}

// Exact rational arithmetic on bigint: rates like base / hours stay exact until the line is rounded (rules 7-9).
export interface Ratio {
  n: bigint;
  d: bigint; // always > 0
}

export const ratio = (n: bigint, d = 1n): Ratio => {
  if (d === 0n) throw new Error("division by zero");
  return d < 0n ? { n: -n, d: -d } : { n, d };
};
export const mul = (a: Ratio, b: Ratio) => ratio(a.n * b.n, a.d * b.d);
export const div = (a: Ratio, b: Ratio) => ratio(a.n * b.d, a.d * b.n);

/** "1.5" / "8" -> exact ratio. Decimal text only; no exponents, no signs. */
export function parseDecimal(text: string): Ratio {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error("invalid decimal");
  const frac = m[2] ?? "";
  return ratio(BigInt(m[1] + frac), 10n ** BigInt(frac.length));
}

/** Micro-USDC ratio -> whole micro-USDC rounded half-up to 0.01 (rule 8). Negative values are a bug upstream. */
export function roundRatioToCent(r: Ratio): MicroUsdc {
  if (r.n < 0n) throw new Error("negative amount");
  const unit = r.d * CENT;
  return ((2n * r.n + unit) / (2n * unit)) * CENT;
}
