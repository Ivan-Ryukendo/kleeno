import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunViewNavigation } from "@/components/run-view-navigation";
import { crumbs, initials, isActive, PAYROLL_FALLBACK, payrollHref, periodLabel, runViews, searchPages, settingsNav, sidebarNav } from "@/components/shell/nav-config";
import { isPaymentRole, type Role } from "@/core/tenancy";

const RUN = "10000000-0000-4000-8000-000000000001";
const ALL: Role[] = ["OWNER", "HR_APPROVER", "PAYROLL_APPROVER", "PAYMENT_APPROVER", "VIEWER"];

// Pages from the R9.1 matrix (docs/route-action-matrix.md, PAGES block). New pages fail here until they get a way in.
const matrix = readFileSync(join(process.cwd(), "docs/route-action-matrix.md"), "utf8");
const pageBlock = matrix.slice(matrix.indexOf("<!-- PAGES:START -->"), matrix.indexOf("<!-- PAGES:END -->"));
const matrixPages = [...pageBlock.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
// Outside the signed-in shell: public, auth-card, signed-link and private admin pages are reached by URL, not navigation.
const OUTSIDE_SHELL = ["/", "/privacy", "/login", "/invite/[token]", "/onboarding", "/select-company", "/receipt/[token]"];

const payrollSide: Role[] = ["OWNER", "HR_APPROVER", "PAYROLL_APPROVER"];
/** Which roles must find each page (convenience only; the page and its handlers still check access). */
const EXPECTED: Record<string, Role[]> = {
  "/dashboard": ALL,
  "/runs/[runId]": ALL,
  "/runs/[runId]/workflow": ALL,
  "/audit": ALL,
  "/workers": ALL,
  "/support": ALL,
  "/account": ALL,
  "/settings/company": ALL,
  "/settings/team": ALL,
  "/exceptions": payrollSide,
  "/import": payrollSide,
  "/configuration": payrollSide,
  "/settlement": ["OWNER", "PAYMENT_APPROVER"],
  "/settings/billing": ["OWNER"],
};

/** Every href a member with these roles can reach from the shell, normalised to the matrix route pattern. */
function reachable(roles: Role[]): Set<string> {
  const runs = [{ id: RUN, label: "2026-10-01 to 2026-10-31" }];
  const hrefs = [
    ...sidebarNav(roles, runs).flatMap((g) => g.items.map((i) => i.href)),
    ...settingsNav(roles).flatMap((g) => g.items.map((i) => i.href)),
    ...searchPages(roles).map((i) => i.href),
    ...runs.map((r) => `/runs/${r.id}`), // search palette: recent pay runs
    ...["SIMULATION", "LIVE_TESTNET"].flatMap((mode) => runViews(RUN, mode, isPaymentRole(roles)).flatMap((v) => (v.href ? [v.href] : []))),
  ];
  return new Set(hrefs.map((h) => h.split(/[?#]/)[0].replace(RUN, "[runId]")));
}

describe("every matrix destination stays reachable", () => {
  it("reads the matrix page list", () => {
    expect(matrixPages.length).toBeGreaterThan(15);
    expect(matrixPages).toContain("/runs/[runId]/workflow");
  });
  it("classifies every signed-in matrix page", () => {
    const shellPages = matrixPages.filter((p) => !OUTSIDE_SHELL.includes(p) && !p.startsWith("/<ADMIN_PATH>"));
    expect(shellPages.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  it.each(Object.entries(EXPECTED).flatMap(([page, roles]) => roles.map((role) => ({ page, role }))))("$page for $role", ({ page, role }) => {
    expect(reachable([role]).has(page)).toBe(true);
  });
  it("keeps Billing, Payments and payroll screens out of the menus of roles that cannot use them", () => {
    expect(reachable(["VIEWER"]).has("/settings/billing")).toBe(false);
    expect(reachable(["VIEWER"]).has("/settlement")).toBe(false);
    expect(reachable(["PAYMENT_APPROVER"]).has("/import")).toBe(false);
    expect(reachable(["HR_APPROVER"]).has("/settlement")).toBe(false);
  });
});

describe("sidebar", () => {
  it("shows Dashboard, Payroll, All Workers, then Settings and Help for every role", () => {
    for (const role of ALL) expect(sidebarNav([role]).map((g) => g.items.map((i) => i.label))).toEqual([["Dashboard", "Payroll", "All Workers"], ["Settings", "Help"]]);
  });
  it("opens the current run from Payroll, or the pay-runs list when there is none", () => {
    expect(payrollHref([])).toBe(PAYROLL_FALLBACK);
    expect(PAYROLL_FALLBACK).toBe("/dashboard#pay-runs");
    expect(payrollHref([{ id: RUN }, { id: "other" }])).toBe(`/runs/${RUN}`);
    expect(sidebarNav(["VIEWER"], [{ id: RUN }])[0].items[1].href).toBe(`/runs/${RUN}`);
  });
  it("highlights Payroll on run pages and its secondary screens, Settings on every settings frame page", () => {
    const [main, secondary] = sidebarNav(["OWNER"]);
    const payroll = main.items[1];
    const settings = secondary.items[0];
    for (const p of [`/runs/${RUN}`, `/runs/${RUN}/workflow`, "/exceptions", "/import", "/settlement", "/audit"]) expect(isActive(payroll, p), p).toBe(true);
    for (const p of ["/settings/company", "/settings/team", "/settings/billing", "/configuration", "/account"]) expect(isActive(settings, p), p).toBe(true);
    expect(isActive(main.items[0], "/dashboard")).toBe(true);
    expect(isActive(payroll, "/dashboard")).toBe(false);
    expect(isActive(main.items[2], "/workers")).toBe(true);
  });
});

describe("run tabs", () => {
  it("are Table, Workflow, Payments, Activity with same-run links", () => {
    const views = runViews(RUN, "LIVE_TESTNET", true);
    expect(views.map((v) => v.label)).toEqual(["Table", "Workflow", "Payments", "Activity"]);
    expect(views.map((v) => v.href)).toEqual([`/runs/${RUN}`, `/runs/${RUN}/workflow`, `/settlement?run=${RUN}`, `/audit?run=${RUN}`]);
  });
  it.each(["SIMULATION", "LIVE_TESTNET"].flatMap((mode) => ALL.map((role) => ({ mode, role }))))("keep the Payments gate for $mode $role", ({ mode, role }) => {
    const payments = runViews(RUN, mode, isPaymentRole([role])).find((v) => v.id === "payments")!;
    expect(payments.href !== null).toBe(mode !== "SIMULATION" && role === "PAYMENT_APPROVER");
    if (!payments.href) expect(payments.reason).toBe(mode === "SIMULATION" ? "Simulation never pays" : "Payment approvers only");
  });
});

describe("settings sections", () => {
  it.each([
    { roles: ["OWNER"] as Role[], expected: ["/settings/company", "/settings/team", "/configuration", "/settings/billing", "/account"] },
    { roles: ["HR_APPROVER"] as Role[], expected: ["/settings/company", "/settings/team", "/configuration", "/account"] },
    { roles: ["PAYMENT_APPROVER"] as Role[], expected: ["/settings/company", "/settings/team", "/account"] },
    { roles: ["VIEWER"] as Role[], expected: ["/settings/company", "/settings/team", "/account"] },
  ])("group Company and Personal for $roles", ({ roles, expected }) => {
    const groups = settingsNav(roles);
    expect(groups.map((g) => g.label)).toEqual(["Company", "Personal"]);
    expect(groups.flatMap((g) => g.items.map((i) => i.href))).toEqual(expected);
  });
});

describe("search palette pages", () => {
  it("offers the screens dropped from the sidebar to the roles that use them", () => {
    const labels = (roles: Role[]) => searchPages(roles).map((i) => i.label);
    expect(labels(["HR_APPROVER"])).toEqual(expect.arrayContaining(["Pay runs", "Start a pay run", "Needs review", "Import", "Activity", "Pay policy", "Account", "Help"]));
    expect(labels(["PAYMENT_APPROVER"])).toEqual(expect.arrayContaining(["Payments", "Activity"]));
    expect(labels(["PAYMENT_APPROVER"])).not.toContain("Start a pay run");
    expect(labels(["OWNER"])).toContain("Billing");
    expect(labels(["OWNER"])).not.toContain("Start a pay run"); // starting a run needs a payroll role (POST /api/runs)
    expect(labels(["VIEWER"])).not.toContain("Billing");
  });
  it("keeps the start-run and pay-runs anchors", () => {
    const hrefs = searchPages(["PAYROLL_APPROVER"]).map((i) => i.href);
    expect(hrefs).toContain("/dashboard#start-run");
    expect(hrefs).toContain("/dashboard#pay-runs");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("breadcrumb", () => {
  const ctx = { company: "Northwind Remote", runs: [{ id: RUN, label: "2026-10-01 to 2026-10-31" }] };
  it.each([
    ["/dashboard", ["Northwind Remote", "Dashboard"]],
    [`/runs/${RUN}`, ["Northwind Remote", "Payroll", "October 2026"]],
    [`/runs/${RUN}/workflow`, ["Northwind Remote", "Payroll", "October 2026", "Workflow"]],
    ["/runs/unknown", ["Northwind Remote", "Payroll", "Run"]],
    ["/exceptions", ["Northwind Remote", "Payroll", "Needs review"]],
    ["/import", ["Northwind Remote", "Payroll", "Import"]],
    ["/settlement", ["Northwind Remote", "Payroll", "Payments"]],
    ["/audit", ["Northwind Remote", "Payroll", "Activity"]],
    ["/workers", ["Northwind Remote", "All Workers"]],
    ["/configuration", ["Northwind Remote", "Settings", "Pay policy"]],
    ["/account", ["Northwind Remote", "Settings", "Account"]],
    ["/support", ["Northwind Remote", "Help"]],
  ])("%s", (pathname, expected) => {
    expect(crumbs(pathname, ctx)).toEqual(expected);
  });
  it("keeps exact dates for periods that are not one calendar month", () => {
    expect(periodLabel("2026-10-01 to 2026-10-14")).toBe("2026-10-01 to 2026-10-14");
    expect(periodLabel("2028-02-01 to 2028-02-29")).toBe("February 2028");
  });
});

it("derives account chip initials from the email only", () => {
  expect(initials("maya.reyes@example.com")).toBe("MR");
  expect(initials("owner@example.com")).toBe("OW");
  expect(initials(null)).toBe("?");
});

describe("run tabs segmented control", () => {
  const render = (props: { mode: string; canPay: boolean; canReview?: boolean }) => renderToStaticMarkup(createElement(RunViewNavigation, { runId: RUN, current: "workflow", ...props }));
  it("shows a closed Payments segment with its reason and no link in SIMULATION", () => {
    const html = render({ mode: "SIMULATION", canPay: true });
    expect(html).not.toContain("/settlement");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("Simulation never pays");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it("keeps 44px touch targets on small screens", () => {
    const links = render({ mode: "LIVE_TESTNET", canPay: true }).match(/<a\b[^>]*>/g) ?? [];
    expect(links).toHaveLength(4);
    for (const link of links) expect(link).toContain("min-h-11");
  });
  it("offers Needs review for this run only to payroll reviewers", () => {
    expect(render({ mode: "SIMULATION", canPay: false, canReview: true })).toContain(`href="/exceptions?run=${RUN}"`);
    expect(render({ mode: "SIMULATION", canPay: false })).not.toContain("/exceptions");
  });
});
