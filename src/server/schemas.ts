import "server-only";
import { z } from "zod";
import { parseUsdc } from "@/core/money";

const MAX_USDC = 1_000_000_000n * 1_000_000n; // 1e9 USDC: keeps every amount far below 2^53 micro-USDC and bigint columns

/** A USDC amount as text ("12.34"): parsed exactly, never as a float. Route files may not export helpers, so it lives here. */
export const usdc = z.string().refine((v) => {
  try {
    return parseUsdc(v) <= MAX_USDC;
  } catch {
    return false;
  }
}, "USDC amount, up to 6 decimals");

export const uuid = z.string().uuid();
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "a real calendar date"); // 2026-02-31 would reach Postgres and 500
