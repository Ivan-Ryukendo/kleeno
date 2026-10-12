import { canonicalHash } from "../canonical";
import type { Clauses } from "../config";
export interface ProposalCacheContext { companyId: string; clauseHash: string; provider: string; models: readonly string[]; promptVersion: string; schemaVersion: string }
export const proposalCacheKey = (context: ProposalCacheContext) => canonicalHash(context);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean));
const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** Warnings only. Tenant restriction and bounded candidate query belong in the repository. */
export function duplicatePolicyWarnings(clauses: Clauses, candidates: { version: number; clauses: Clauses }[]): string[] {
  const warnings: string[] = [];
  // ponytail: bounded recent corpus, exact hashes then token overlap; add indexed encrypted-safe retrieval only after a reviewed storage design.
  const previous = candidates.flatMap(c => c.clauses.map(cl => ({ ...cl, reference: `v${c.version}/${cl.id}` })));
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i], text = normalized(c.text), tokens = words(c.text);
    for (const old of [...previous, ...clauses.slice(0, i).map(cl => ({ ...cl, reference: cl.id }))]) {
      if (text === normalized(old.text)) warnings.push(`${c.id}: exact duplicate of ${old.reference}`);
      else {
        const other = words(old.text), shared = [...tokens].filter(t => other.has(t)).length;
        if (tokens.size >= 8 && shared / Math.max(tokens.size, other.size) >= 0.9) warnings.push(`${c.id}: near duplicate of ${old.reference}; review both clauses`);
      }
      if (warnings.length >= 100) return warnings;
    }
  }
  return warnings;
}
