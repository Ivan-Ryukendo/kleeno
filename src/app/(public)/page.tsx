import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist-form";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { absolute: "Kleeno · AI payroll reconciliation for teams that pay contractors" },
  alternates: { canonical: "/" },
  openGraph: { url: "/" },
};

const problems = [
  { title: "Hours that don't add up", body: "Missed, unapproved or duplicated timesheet hours slip into pay, and you find them after payday, or never." },
  { title: "Rules living in spreadsheets", body: "Overtime, leave and contractor rates sit in formulas nobody can explain when a number is questioned." },
  { title: "Paying the wrong person", body: "A changed bank or wallet detail looks like any other row until the money has already gone." },
];

const steps = [
  { n: "01", title: "Policy", body: "Paste your pay policy. AI proposes structured pay rules, each linked to the sentence it came from. You approve them." },
  { n: "02", title: "Check", body: "Import timesheets and pay data. Kleeno reconciles them and flags every discrepancy with the rows that prove it." },
  { n: "03", title: "Approve", body: "Plain, deterministic code calculates pay. Every amount has a line-by-line trace you can read before you sign off." },
  { n: "04", title: "Pay", body: "A second person approves payment. Payments go out exactly as approved and are matched back to the record." },
];

const audiences = [
  { title: "US businesses paying remote contractors", body: "Hourly, salaried or fixed-retainer contractors across borders, without spreadsheet guesswork." },
  { title: "Payroll and finance leads", body: "Controllers and heads of finance who need to explain every payroll number to an auditor." },
  { title: "Payroll bureaus and accounting firms", body: "Teams running payroll for many clients who need consistent rules and a clean audit trail." },
  { title: "Founders and operations", body: "Small teams where payroll is one job among many and mistakes are expensive." },
];

const faqs = [
  { q: "What is Kleeno?", a: "Kleeno is AI-assisted payroll software for configuration and reconciliation. It turns your pay policy into structured rules, reconciles timesheets and pay data, flags discrepancies with evidence, and explains every calculated amount line by line." },
  { q: "Is Kleeno available now?", a: "Not yet. Kleeno is in development. Joining the waitlist gets you updates and a chance at early access; it does not guarantee access." },
  { q: "Does the AI calculate pay?", a: "No. AI reads your policy and messy data and proposes rules and flags. Plain, deterministic code does every calculation, and a person approves the result. The AI never sets an amount or approves anything." },
  { q: "How does payroll reconciliation work in Kleeno?", a: "Kleeno compares timesheets, approvals and pay records and raises an exception for anything that does not match, such as unexplained missing hours, a duplicate timesheet, unapproved overtime or leave that overlaps with work. Each exception shows the source rows, and a person resolves it." },
  { q: "How will contractor payments work?", a: "After two different people approve payroll and payment, payments go out exactly as approved and are matched back to each line. Today Kleeno is tested with USDC stablecoin payments on a test network, which moves no real money." },
  { q: "Does Kleeno keep an audit trail?", a: "Yes. Every step, from policy to rules, data, exceptions, calculation, approval and payment, is recorded in an append-only audit trail that you can review." },
  { q: "How much will Kleeno cost?", a: "Pricing is not set yet. The optional survey after you join helps us set it. Waitlist members will hear about pricing and any early-access offer first." },
  { q: "What do you do with my email?", a: "We use it only to tell you about Kleeno's launch and early access, and to contact you if you ask for a call. We never sell it. You can ask us to delete it at any time; see the privacy note." },
];

function HeroArt() {
  return (
    <svg viewBox="0 0 480 480" className="h-auto w-full max-w-[26rem]" aria-hidden focusable="false">
      <path d="M20 330 C 80 120, 300 40, 460 120" fill="none" className="stroke-orbit" strokeWidth="1.5" />
      <path d="M40 420 C 180 300, 380 330, 470 250" fill="none" className="stroke-orbit" strokeWidth="1.2" />
      <circle cx="250" cy="240" r="150" className="fill-primary" />
      <circle cx="250" cy="240" r="96" fill="none" className="stroke-primary-foreground/25" strokeWidth="1" />
      <g className="fill-primary-foreground" fontFamily="inherit">
        <text x="250" y="222" textAnchor="middle" fontSize="20" opacity="0.7">net pay</text>
        <text x="250" y="262" textAnchor="middle" fontSize="38" fontWeight="500">= traced</text>
      </g>
      <circle cx="95" cy="120" r="56" className="fill-card" />
      <text x="95" y="126" textAnchor="middle" fontSize="16" className="fill-foreground" fontWeight="500">policy</text>
      <circle cx="400" cy="380" r="46" className="fill-white" />
      <path d="M385 380 h28 m-10 -10 l10 10 l-10 10" fill="none" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
      <circle cx="415" cy="100" r="10" className="fill-orbit" />
    </svg>
  );
}

const eyebrow = (label: string) => (
  <p className="text-sm font-bold uppercase tracking-[0.04em]">
    <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
    {label}
  </p>
);

export default function LandingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", name: "Kleeno", url: env.SITE_URL, description: "AI-assisted payroll reconciliation and configuration (in development)." },
      { "@type": "WebSite", name: "Kleeno", url: env.SITE_URL },
      { "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    ],
  };

  return (
    <main id="main">
      {/* React escapes "</script" inside script text, so this needs no raw-HTML injection (S24). */}
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>

      <section id="join" className="mx-auto grid max-w-6xl scroll-mt-28 items-start gap-12 px-6 pb-20 pt-14 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div>
          {eyebrow("In development · Early-access waitlist")}
          <h1 className="mt-6 text-5xl font-medium leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
            AI payroll reconciliation for teams that pay contractors.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted-foreground">
            Kleeno reads your pay policy and messy timesheets, flags every payroll discrepancy with evidence, and explains each amount line by line. AI suggests. Plain code calculates. You approve.
          </p>
          <div className="mt-10 hidden lg:block">
            <HeroArt />
          </div>
        </div>
        <div className="rounded-[2.5rem] bg-card p-8 shadow-card sm:p-10 lg:mt-10">
          <h2 className="text-2xl font-medium tracking-tight">Join the waitlist</h2>
          <p className="mb-6 mt-2 text-muted-foreground">Be first to try Kleeno when it opens. One email field; nothing else required.</p>
          <WaitlistForm />
        </div>
      </section>

      <section id="problems" aria-labelledby="problems-title" className="relative overflow-hidden px-6 py-24">
        <p aria-hidden className="pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[7rem] font-medium leading-none tracking-[-0.02em] text-ghost sm:text-[10rem]">
          discrepancies
        </p>
        <div className="relative mx-auto max-w-6xl">
          {eyebrow("The problem")}
          <h2 id="problems-title" className="mt-4 max-w-3xl text-4xl font-medium tracking-[-0.02em] sm:text-5xl">
            Payroll errors hide in spreadsheets until someone is paid wrong.
          </h2>
          <ul className="mt-14 grid gap-10 md:grid-cols-3">
            {problems.map((p, i) => (
              <li key={p.title}>
                <span aria-hidden className="flex size-20 items-center justify-center rounded-full bg-white text-2xl font-medium shadow-card">
                  {i + 1}
                </span>
                <h3 className="mt-6 text-2xl font-medium tracking-[-0.02em]">{p.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-28 px-6 py-24">
        <div className="mx-auto max-w-6xl rounded-[2.5rem] bg-card px-6 py-16 sm:px-12">
          {eyebrow("How it works")}
          <h2 id="how-title" className="mt-4 max-w-3xl text-4xl font-medium tracking-[-0.02em] sm:text-5xl">
            From pay policy to an explained, approved payroll.
          </h2>
          <ol className="relative mt-14 grid gap-10 md:grid-cols-4">
            <svg aria-hidden viewBox="0 0 1000 80" preserveAspectRatio="none" className="pointer-events-none absolute left-0 top-6 hidden h-16 w-full md:block">
              <path d="M40 60 C 250 -10, 420 -10, 520 40 S 820 90, 960 20" fill="none" className="stroke-orbit" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
            {steps.map((s) => (
              <li key={s.n} className="relative">
                <span className="flex size-16 items-center justify-center rounded-full bg-primary text-lg font-medium text-primary-foreground">{s.n}</span>
                <h3 className="mt-6 text-2xl font-medium tracking-[-0.02em]">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="who-its-for" aria-labelledby="who-title" className="scroll-mt-28 px-6 py-24">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            {eyebrow("Who it's for")}
            <h2 id="who-title" className="mt-4 text-4xl font-medium tracking-[-0.02em] sm:text-5xl">
              Built for the people who answer for payroll.
            </h2>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {audiences.map((a) => (
              <li key={a.title} className="rounded-[2.5rem] bg-white p-8">
                <h3 className="text-xl font-medium tracking-[-0.02em]">{a.title}</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">{a.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="principles-title" className="px-6 py-24">
        <div className="mx-auto max-w-6xl text-center">
          {eyebrow("Our principles")}
          <h2 id="principles-title" className="mx-auto mt-4 max-w-3xl text-4xl font-medium tracking-[-0.02em] sm:text-6xl">
            AI proposes. You decide. Every step is on record.
          </h2>
          <ul className="mx-auto mt-14 grid max-w-5xl gap-10 text-left md:grid-cols-3">
            <li>
              <h3 className="text-xl font-medium">AI never sets an amount</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">It proposes rules and flags issues. Deterministic code calculates, and the same inputs always give the same result.</p>
            </li>
            <li>
              <h3 className="text-xl font-medium">Two people, two approvals</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">One person approves payroll; a different person approves payment. Nothing is paid behind your back.</p>
            </li>
            <li>
              <h3 className="text-xl font-medium">A payroll audit trail by default</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">Policy, data, exceptions, calculations, approvals and payments are linked in one append-only record.</p>
            </li>
          </ul>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          {eyebrow("FAQ")}
          <h2 id="faq-title" className="mt-4 text-4xl font-medium tracking-[-0.02em] sm:text-5xl">Questions, answered plainly.</h2>
          <div className="mt-10 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="group rounded-[1.25rem] bg-white px-6 py-5 open:pb-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  <h3>{f.q}</h3>
                  <span aria-hidden className="text-2xl leading-none transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="px-6 pt-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-[2.5rem] bg-card px-8 py-14 sm:px-14 md:flex-row md:items-center">
          <div>
            <h2 id="cta-title" className="text-3xl font-medium tracking-[-0.02em] sm:text-4xl">Be first to try Kleeno.</h2>
            <p className="mt-3 max-w-xl text-lg text-muted-foreground">Join the waitlist for launch news, pricing and early-access offers. Unsubscribe any time.</p>
          </div>
          <a href="#join" className="inline-flex h-12 items-center rounded-[1.25rem] bg-primary px-7 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            Join the waitlist
          </a>
        </div>
      </section>
    </main>
  );
}
