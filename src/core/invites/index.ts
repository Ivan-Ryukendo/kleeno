import { z } from "zod";
import { ROLES, isAuthorityRole, type Role } from "../tenancy";

// Invites (S62): a one-time link, 7 days, bound to one email. Pure rules only; tokens and storage live in src/server.
export const INVITE_TTL_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12; // same as the Supabase Auth setting

export const InviteEmail = z.string().trim().toLowerCase().email().max(254);
export const InviteRoles = z
  .array(z.enum(ROLES))
  .min(1)
  .max(ROLES.length)
  .transform((r) => [...new Set(r)]);

export type InviteStatus = "PENDING" | "USED" | "EXPIRED" | "REVOKED";
export interface InviteRecord {
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export function inviteStatus(i: InviteRecord, now: Date = new Date()): InviteStatus {
  if (i.usedAt) return "USED";
  if (i.revokedAt) return "REVOKED";
  return Date.parse(i.expiresAt) <= now.getTime() ? "EXPIRED" : "PENDING";
}

export const inviteExpiry = (now: Date = new Date()) => new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

/** Granting payroll or payment authority needs the inviter's password again (rule 47, S63). */
export const needsReauth = (roles: readonly Role[]) => roles.some(isAuthorityRole);

/** The one reply for every bad link: unknown, used, expired, revoked or wrong email (S62). */
export const INVALID_INVITE_MESSAGE = "This invitation link is not valid or has expired. Ask for a new one.";
