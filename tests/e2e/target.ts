// Browser tests create users and companies: loopback Supabase (CI) or the one pinned hosted kleeno-test project only.
const KLEENO_TEST_REF = "axcgcjpmcdujxkvroqox";

export function assertDisposableTarget() {
  const host = new URL(process.env.SUPABASE_URL ?? "http://invalid").hostname;
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  const pinned = process.env.SUPABASE_TEST_PROJECT_REF === KLEENO_TEST_REF && host === `${KLEENO_TEST_REF}.supabase.co`;
  if (!loopback && !pinned) throw new Error("e2e requires isolated local Supabase or the pinned kleeno-test project");
}
