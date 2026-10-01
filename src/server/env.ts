import "server-only";
import { z } from "zod";
import { parseMasterKey } from "./crypto/cipher";

const masterKey = z.string().refine((v) => {
  try {
    parseMasterKey(v);
    return true;
  } catch {
    return false;
  }
}, "at least 32 random bytes, hex or base64");

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1), // public by design (rule 32): anon has no table rights
  // >= 32 random bytes (hex or base64); a "vN:" prefix sets the version (S41, docs/security.md §2)
  DATA_ENCRYPTION_KEY: masterKey,
  DATA_ENCRYPTION_KEY_PREVIOUS: masterKey.optional(),
  OPENROUTER_API_KEY: z.string().min(1),
  // Model and fallback are config, not code, so they can change freely (ARCHITECTURE 7).
  OPENROUTER_MODEL: z.string().min(1).default("z-ai/glm-5.3-flash"),
  OPENROUTER_FALLBACK_MODEL: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(`Missing or invalid environment variables: ${names}`);
}

export const env = parsed.data;
