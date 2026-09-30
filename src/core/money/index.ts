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
