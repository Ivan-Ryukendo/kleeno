// Test server only: an accidental AI/provider call fails locally, without using keys or transmitting fixtures.
const localFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const testHost = process.env.SUPABASE_TEST_PROJECT_REF === "axcgcjpmcdujxkvroqox" ? "axcgcjpmcdujxkvroqox.supabase.co" : "";
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) && url.hostname !== testHost) throw new Error("external provider disabled in isolated e2e");
  return localFetch(input, init);
};
