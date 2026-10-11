import { describe, expect, it } from "vitest";
import { nextPayDates, todayIn } from "@/lib/pay-dates";

describe("pay date preview", () => {
  it("monthly: fixed day, last day, and short months clamp to the month end", () => {
    expect(nextPayDates("MONTHLY", 25, "2026-10-12").map(d => d.payDate)).toEqual(["Sun, Oct 25", "Wed, Nov 25"]);
    expect(nextPayDates("MONTHLY", 31, "2026-10-12").map(d => d.payDate)).toEqual(["Sat, Oct 31", "Mon, Nov 30"]);
    expect(nextPayDates("MONTHLY", 28, "2026-10-29").map(d => d.month)).toEqual(["November 2026", "December 2026"]);
    expect(nextPayDates("MONTHLY", 25, "2026-10-25", 1).map(d => d.payDate)).toEqual(["Sun, Oct 25"]); // today counts
  });
  it("twice a month and weekly follow the saved rule", () => {
    expect(nextPayDates("SEMI_MONTHLY", null, "2026-10-16").map(d => d.payDate)).toEqual(["Sat, Oct 31", "Sun, Nov 15"]);
    expect(nextPayDates("WEEKLY", 5, "2026-10-12").map(d => d.payDate)).toEqual(["Fri, Oct 16", "Fri, Oct 23"]);
  });
  it("every two weeks and unset schedules have no preview (nothing is invented)", () => {
    expect(nextPayDates("BIWEEKLY", 5, "2026-10-12")).toEqual([]);
    expect(nextPayDates(null, null, "2026-10-12")).toEqual([]);
    expect(nextPayDates("MONTHLY", null, "2026-10-12")).toEqual([]);
  });
  it("today follows the company time zone and survives a bad zone", () => {
    const instant = new Date("2026-10-12T23:30:00Z");
    expect(todayIn("Asia/Dhaka", instant)).toBe("2026-10-13");
    expect(todayIn("America/New_York", instant)).toBe("2026-10-12");
    expect(todayIn("Not/AZone", instant)).toBe("2026-10-12");
    expect(todayIn(null, instant)).toBe("2026-10-12");
  });
});
