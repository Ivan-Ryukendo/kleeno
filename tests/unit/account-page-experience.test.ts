import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AccountPage from "@/app/(app)/(workspace)/account/page";

const mocks = vi.hoisted(() => ({
  user: {
    id: "user-1",
    email: "current@example.test",
    email_confirmed_at: "2026-03-04T10:00:00.000Z",
    created_at: "2025-03-04T10:00:00.000Z",
    identities: [
      { provider: "email", created_at: "2025-03-04T10:00:00.000Z", identity_data: { email: "current@example.test" } },
      { provider: "google", created_at: "2026-09-02T10:00:00.000Z", identity_data: { email: "current@example.test" } },
    ],
    app_metadata: { providers: ["email", "google"] },
  },
  companies: [
    { companyId: "company-1", name: "Northwind Remote", roles: ["HR_APPROVER"], mfaRequired: false },
    { companyId: "company-2", name: "Kestrel Labs", roles: ["PAYROLL_APPROVER", "PAYMENT_APPROVER"], mfaRequired: false },
  ],
  aal: "aal2" as "aal1" | "aal2",
  mfaRequired: false,
  userStatus: "ok" as "ok" | "missing" | "mismatch" | "error",
}));

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/auth/page-session", () => ({
  pageSession: async () => ({
    actor: { userId: "user-1", email: "stale-membership@example.test", companyId: "company-1", roles: ["HR_APPROVER"], mfaRequired: mocks.mfaRequired, aal: mocks.aal },
    companies: mocks.companies,
    client: { auth: { mfa: { listFactors: async () => ({ data: { totp: [{ id: "factor-1" }] } }) }, getUser: async () => ({ data: { user: mocks.userStatus === "missing" ? null : mocks.userStatus === "mismatch" ? { ...mocks.user, id: "another-user" } : mocks.user }, error: mocks.userStatus === "error" ? new Error("provider error") : null }) } },
  }),
}));
vi.mock("@/server/auth/oauth", () => ({
  linkedMethods: (user: typeof mocks.user) => user.identities.map((identity) => identity.provider === "email" ? "password" : identity.provider),
}));

const render = async () => renderToStaticMarkup(await AccountPage());

describe("account settings experience", () => {
  beforeEach(() => {
    mocks.aal = "aal2";
    mocks.mfaRequired = false;
    mocks.userStatus = "ok";
    mocks.user = {
      id: "user-1",
      email: "current@example.test",
      email_confirmed_at: "2026-03-04T10:00:00.000Z",
      created_at: "2025-03-04T10:00:00.000Z",
      identities: [
        { provider: "email", created_at: "2025-03-04T10:00:00.000Z", identity_data: { email: "current@example.test" } },
        { provider: "google", created_at: "2026-09-02T10:00:00.000Z", identity_data: { email: "current@example.test" } },
      ],
      app_metadata: { providers: ["email", "google"] },
    };
  });

  it("shows verified identity metadata, companies and safe native account actions in Settings", async () => {
    const html = await render();
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain("current@example.test");
    expect(html).toContain("Verified");
    expect(html).not.toContain("stale-membership@example.test");
    expect(html).toContain("Joined Kleeno on Mar 4, 2025");
    expect(html).toContain("Google");
    expect(html).toContain("Sep 2, 2026");
    expect(html).toContain("Your companies and roles");
    expect(html).toContain("Northwind Remote");
    expect(html).toContain("Kestrel Labs");
    expect(html).toContain("Switch");
    expect(html).toContain("Sign out everywhere else");
    expect(html).toContain("Confirm your password");
    expect(html).not.toContain("Where you're signed in");
    expect(html).not.toContain("Recovery codes");
  });

  it("does not offer Google unlink when Google is the only sign-in method", async () => {
    mocks.user.identities = [
      { provider: "google", created_at: "2026-09-02T10:00:00.000Z", identity_data: { email: "current@example.test" } },
    ];
    mocks.user.app_metadata = { providers: ["google"] };
    const html = await render();
    expect(html).toContain("Google");
    expect(html).toContain("only sign-in method");
    expect(html).not.toContain("Confirm your password");
  });

  it("withholds account actions until a required second factor is verified", async () => {
    mocks.aal = "aal1";
    mocks.mfaRequired = true;
    const html = await render();
    expect(html).toContain("Complete multi-factor sign-in before changing account security settings.");
    expect(html).not.toContain("Confirm your password");
    expect(html).not.toContain("Unlink Google");
    expect(html).toContain("Your companies and roles");
    expect(html).toContain("Complete multi-factor sign-in before switching companies.");
  });

  it.each(["missing", "mismatch", "error"] as const)("does not show verified identity claims when the current user is %s", async (userStatus) => {
    mocks.userStatus = userStatus;
    const html = await render();
    expect(html).toContain("Not available");
    expect(html).toContain("Not verified");
    expect(html).toContain("Join date not available");
    expect(html).not.toContain("current@example.test");
    expect(html).not.toContain("Sep 2, 2026");
    expect(html).not.toContain("Confirm your password");
  });
});
