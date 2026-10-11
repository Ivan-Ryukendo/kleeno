import { localTimeParts } from "@/lib/timezone-display";

/** A stored UTC instant shown in the viewer's zone: "Oct 17, 2026, 12:00 PM (Dhaka, UTC+6)".
 * The zone is resolved on the server and passed in, so server and client agree; no Date.now(). Values that are not instants render unchanged. */
export function LocalTime({ at, timeZone, className }: { at: string; timeZone: string; className?: string }) {
  const parts = localTimeParts(at, timeZone);
  if (!parts) return <time className={className}>{at}</time>;
  return (
    // Browsers and Node can differ in ICU spacing (e.g. narrow no-break space before PM); the text is display-only.
    <time dateTime={at} title={`${at} (stored as UTC)`} className={className} suppressHydrationWarning>
      {`${parts.text} (${parts.zone})`}
    </time>
  );
}
