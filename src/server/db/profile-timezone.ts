import "server-only";
import { resolveTimeZone, timeZoneLabel, TimeZonePreferenceSchema, TimeZoneSchema } from "@/core/timezone";
import { WorkflowError } from "@/core/workflow";
import { db, must } from "./client";

type Who = { userId: string; companyId: string };
async function currentMembership(who: Who) {
  const result = await db().from("memberships").select("user_id").eq("company_id", who.companyId).eq("user_id", who.userId).is("removed_at", null).maybeSingle();
  if (result.error) throw new Error("profile membership unavailable");
  if (!result.data) throw new WorkflowError("FORBIDDEN", "Current company membership is required");
}

export async function loadProfileTimezone(who: Who) {
  await currentMembership(who);
  const preference = await db().schema("growth").from("user_preferences").select("timezone").eq("user_id", who.userId).maybeSingle();
  if (preference.error) throw new Error("profile timezone unavailable");
  const company = must(await db().from("companies").select("timezone").eq("id", who.companyId).maybeSingle(), "profile company timezone");
  const preferenceTimezone = TimeZoneSchema.safeParse(preference.data?.timezone);
  const companyTimezone = TimeZoneSchema.safeParse(company.timezone);
  const resolved = resolveTimeZone(preferenceTimezone.success ? preferenceTimezone.data : null, companyTimezone.success ? companyTimezone.data : null);
  return { preferenceTimezone: preferenceTimezone.success ? preferenceTimezone.data : null, companyTimezone: companyTimezone.success ? companyTimezone.data : null, ...resolved, label: timeZoneLabel(resolved.timeZone) };
}

export async function saveProfileTimezone(who: Who, raw: unknown) {
  const { timezone } = TimeZonePreferenceSchema.parse(raw);
  await currentMembership(who);
  // Identity comes only from the authenticated actor; company selection never changes whose preference is written.
  const saved = await db().schema("growth").from("user_preferences").upsert({ user_id: who.userId, timezone }, { onConflict: "user_id" });
  if (saved.error) throw new Error("profile timezone save failed");
  return loadProfileTimezone(who);
}
