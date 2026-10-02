import { describe, expect, it } from "vitest";
import { BasicsSchema, ScheduleSchema, payDayLabel, profileComplete } from "@/core/company";
import { INVALID_INVITE_MESSAGE, inviteStatus, needsReauth } from "@/core/invites";
import { setupChecklist } from "@/core/setup";

const basics = { name: "Acme", country: "US", timezone: "Europe/London", sizeRange: "11_50", industry: "AGENCY" };

describe("company profile", () => {
  it("accepts a real country and time zone; rejects unknown ones and extra fields", () => {
    expect(BasicsSchema.safeParse(basics).success).toBe(true);
    for (const bad of [{ country: "ZZ" }, { country: "USA" }, { timezone: "Mars/Base" }, { sizeRange: "HUGE" }, { name: "  " }, { onboarded_at: "x" }])
      expect(BasicsSchema.safeParse({ ...basics, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });

  it("a pay day must fit the frequency", () => {
    const ok = (payFrequency: string, payDay: number | null) => ScheduleSchema.safeParse({ payFrequency, payDay }).success;
    expect([ok("MONTHLY", 25), ok("MONTHLY", 31), ok("MONTHLY", 30), ok("MONTHLY", null)]).toEqual([true, true, false, false]);
    expect([ok("WEEKLY", 5), ok("BIWEEKLY", 7), ok("WEEKLY", 8)]).toEqual([true, true, false]);
    expect([ok("SEMI_MONTHLY", null), ok("SEMI_MONTHLY", 15)]).toEqual([true, false]);
  });

  it("is complete only with both the basics and the schedule", () => {
    const empty = { name: null, country: null, timezone: null, sizeRange: null, industry: null, payFrequency: null, payDay: null };
    expect(profileComplete(empty)).toBe(false);
    expect(profileComplete({ ...empty, ...basics })).toBe(false);
    expect(profileComplete({ ...empty, ...basics, payFrequency: "WEEKLY", payDay: 5 })).toBe(true);
    expect([payDayLabel("WEEKLY", 5), payDayLabel("MONTHLY", 31), payDayLabel("MONTHLY", 25), payDayLabel("SEMI_MONTHLY", null)]).toEqual(["Friday", "the last day of the month", "day 25 of the month", "the 15th and the last day"]);
  });
});

describe("invites", () => {
  const now = new Date("2026-10-10T00:00:00Z");
  it("status follows used, revoked, then expiry", () => {
    const base = { expiresAt: "2026-10-11T00:00:00Z", usedAt: null, revokedAt: null };
    expect(inviteStatus(base, now)).toBe("PENDING");
    expect(inviteStatus({ ...base, expiresAt: "2026-10-10T00:00:00Z" }, now)).toBe("EXPIRED");
    expect(inviteStatus({ ...base, revokedAt: "2026-10-09T00:00:00Z" }, now)).toBe("REVOKED");
    expect(inviteStatus({ ...base, usedAt: "2026-10-09T00:00:00Z" }, now)).toBe("USED");
  });
  it("only payroll and payment roles need the password again", () => {
    expect([needsReauth(["VIEWER", "OWNER", "HR_APPROVER"]), needsReauth(["VIEWER", "PAYMENT_APPROVER"]), needsReauth(["PAYROLL_APPROVER"])]).toEqual([false, true, true]);
    expect(INVALID_INVITE_MESSAGE).not.toMatch(/used|expired at|revoked|email/i); // it never says which case it was
  });
});

describe("setup checklist", () => {
  it("lists the steps in order and points at the next open one", () => {
    const c = setupChecklist({ teamInvited: true, workers: 0, policyApproved: false, runs: 0 });
    expect(c.items.map((i) => [i.id, i.done])).toEqual([["team", true], ["workers", false], ["policy", false], ["run", false]]);
    expect([c.done, c.total, c.next?.id]).toEqual([1, 4, "workers"]);
    expect(setupChecklist({ teamInvited: true, workers: 3, policyApproved: true, runs: 1 }).next).toBeNull();
  });
});
