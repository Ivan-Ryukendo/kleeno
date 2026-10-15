import { ImageResponse } from "next/og";

// Share card for LinkedIn, X and Slack (DESIGN.md: cream canvas, ink type, an orbit arc). Colours mirror the globals.css tokens.
export const alt = "Kleeno: AI payroll that measures every hire and shows its working";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#F3F0EE", color: "#141413", padding: 72, position: "relative" }}>
        <svg width="1200" height="630" viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <path d="M620 600 C 760 260, 1000 160, 1200 220" fill="none" stroke="#F37338" strokeWidth="3" />
          <circle cx="1010" cy="400" r="150" fill="#141413" />
          <circle cx="860" cy="210" r="56" fill="#FCFBFA" />
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40, fontWeight: 600 }}>
          <div style={{ width: 22, height: 22, borderRadius: 999, background: "#141413" }} />
          Kleeno
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
          <div style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.05, letterSpacing: -1.5 }}>AI that reads every source, measures every hire, and shows its working.</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#565656" }}>Every amount traced to its source. Join the waitlist.</div>
        </div>
      </div>
    ),
    size,
  );
}
