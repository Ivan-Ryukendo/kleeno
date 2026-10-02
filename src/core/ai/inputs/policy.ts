import { z } from "zod";
import { ClausesSchema, RULE_IDS, type Clauses } from "../../config";
import { makeInput } from ".";

export const PolicyInputSchema = z.object({ clauses: ClausesSchema, ruleCatalog: z.array(z.enum(RULE_IDS)) }).strict();

export const policyInput = (clauses: Clauses, ref: string) => makeInput("POLICY_INTERPRET", PolicyInputSchema, { clauses, ruleCatalog: [...RULE_IDS] }, ref);
