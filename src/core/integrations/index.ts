import { z } from "zod";

// Capabilities, not vendors (rule 52). Read-only evidence capabilities only: none exists for approval, payment,
// recipient or state change, and `src/core` never names a vendor. Connectors come after the hackathon.
export const CAPABILITIES = ["workers.read", "schedules.read", "timesheets.read", "leave.read", "payments_made.read"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const OBJECT_TYPES = ["worker", "schedule", "timesheet", "leave", "actual_payment"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export interface ProviderDescriptor {
  id: string;
  category: "file_upload";
  capabilities: readonly Capability[];
}

const PROVIDERS: Record<string, ProviderDescriptor> = {
  csv_upload: { id: "csv_upload", category: "file_upload", capabilities: CAPABILITIES },
};

export class CapabilityError extends Error {
  readonly code = "CAPABILITY_NOT_SUPPORTED";
}

/** Fails closed: an unknown provider or an undeclared capability is refused (S47). */
export function requireCapability(providerId: string, capability: Capability): ProviderDescriptor {
  const p = PROVIDERS[providerId];
  if (!p || !p.capabilities.includes(capability)) throw new CapabilityError(`${providerId} does not support ${capability}`);
  return p;
}

/** Every imported record carries this (rule 53, S46). No raw payload: only a hash of the normalized record. */
export const ProvenanceSchema = z
  .object({
    sourceProvider: z.string().refine((v) => v in PROVIDERS, "known provider"),
    objectType: z.enum(OBJECT_TYPES),
    objectId: z.string().min(1).max(200), // the natural key for CSV
    fetchedAt: z.string().datetime(),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    reference: z.string().uuid(), // import batch
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;
