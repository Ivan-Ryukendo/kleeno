import { z } from "zod";
import { ClausesSchema, type Clauses } from "../../config";
import { makeInput } from ".";

const CATALOG = ["INPUT", "ATTENDANCE_DAYS", "LEAVE_BALANCE", "PERFORMANCE"] as const;
export const ResourcePolicyInputSchema = z.object({ clauses: ClausesSchema, configVersion: z.number().int().positive(), resourceCatalog: z.array(z.enum(CATALOG)) }).strict();
export const resourcePolicyInput = (clauses: Clauses, configVersion: number, ref: string) => makeInput("POLICY_INTERPRET", ResourcePolicyInputSchema, { clauses, configVersion, resourceCatalog: [...CATALOG] }, ref);
