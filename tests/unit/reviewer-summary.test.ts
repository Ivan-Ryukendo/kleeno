import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/server/db/review-readiness", () => ({ reviewReadiness: vi.fn() }));
vi.mock("@/server/db/payroll-review", () => ({ loadPayrollReview: vi.fn() }));
import { reviewReadiness } from "@/server/db/review-readiness";
import { loadPayrollReview } from "@/server/db/payroll-review";
import { reviewerSummary } from "@/server/db/reviewer-summary";
const client = {} as SupabaseClient;
beforeEach(() => vi.clearAllMocks());
it.each(["VIEWER", "OWNER"] as const)("denies %s before reading private evidence", async role => {
  await expect(reviewerSummary(client, { companyId: "company", roles: [role] }, "run")).rejects.toThrow("Your role cannot inspect");
  expect(reviewReadiness).not.toHaveBeenCalled();
  expect(loadPayrollReview).not.toHaveBeenCalled();
});
it("fails closed when authorized dashboard evidence is unavailable", async () => {
  vi.mocked(reviewReadiness).mockRejectedValue(new Error("evidence unavailable"));
  await expect(reviewerSummary(client, { companyId: "company", roles: ["HR_APPROVER"] }, "run")).rejects.toThrow("evidence unavailable");
  expect(reviewReadiness).toHaveBeenCalledWith(client, "company", "run");
});
