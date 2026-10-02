import { z } from "zod";
import { OPTIONS, RECON_CATEGORIES, type ReconCategory } from "../../reconciliation";
import { makeInput } from ".";

// Reconciliation classification input (S21): a ref, the category, the pay type, the allowed decisions and the detected facts.
// Facts are dates, hours and counts only: the regex below admits digits, dots, commas and dashes, never words.
const ALL_ACTIONS = [...new Set(Object.values(OPTIONS).flat())] as [string, ...string[]];
const FACT_KEYS = ["date", "rows", "hours", "leaveHours", "workedHours", "payType", "weekStart", "overtimeHours", "approvedHours", "unapprovedHours", "scheduledHours", "missingHours"] as const;
const PAY_TYPES = ["SALARIED", "HOURLY", "RETAINER"] as const;

export const ReconItemSchema = z
  .object({
    ref: z.string().regex(/^e\d{1,3}$/),
    category: z.enum(RECON_CATEGORIES as [ReconCategory, ...ReconCategory[]]),
    payType: z.enum(PAY_TYPES),
    facts: z.partialRecord(z.enum(FACT_KEYS), z.string().regex(/^[\d.,-]{1,60}$|^(SALARIED|HOURLY|RETAINER)$/)),
    options: z.array(z.enum(ALL_ACTIONS)).min(1).max(6),
  })
  .strict();
export type ReconItem = z.infer<typeof ReconItemSchema>;

export const ReconInputSchema = z.object({ items: z.array(ReconItemSchema).min(1).max(40) }).strict();

export const reconInput = (items: unknown[], ref: string) => makeInput("RECON_CLASSIFY", ReconInputSchema, { items }, ref);
