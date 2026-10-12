import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist-form";
import { FaqItem } from "@/components/landing-faq";
import { LandingMotion, ScrubWords } from "@/components/landing-motion";
import { LandingSteps, type LandingStep } from "@/components/landing-steps";
import {
  ApprovalsVisual,
  HoursCheckVisual,
  ImportVisual,
  InlinePill,
  PolicyRuleVisual,
  ReceiptVisual,
  RunReviewVisual,
  TraceVisual,
  WalletChangeVisual,
} from "@/components/landing-visuals";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { absolute: "Kleeno · AI payroll reconciliation for teams that pay contractors" },
  alternates: { canonical: "/" },
  // A page-level openGraph replaces the layout's, so repeat the site fields and name the share card (app/opengraph-image.tsx) here.
  openGraph: { url: "/", siteName: "Kleeno", type: "website", locale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Kleeno: AI payroll reconciliation for teams that pay contractors" }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

const steps: LandingStep[] = [
  { title: "Policy", body: "Paste your pay policy. AI proposes structured pay rules, each linked to the sentence it came from.", detail: "Validation checks every rule for clashes and gaps. Nothing applies until an HR approver accepts a version." },
  { title: "Check", body: "Import timesheets and pay data. Kleeno reconciles them and flags every discrepancy with the rows that prove it.", detail: "Names are replaced by worker codes in your browser before anything is uploaded. You resolve each exception." },
  { title: "Approve", body: "Plain, deterministic code calculates pay. Every amount has a line-by-line trace you can read before you sign off.", detail: "The same inputs always give the same result. Payroll approval asks for your password again." },
  { title: "Pay", body: "A different person approves payment. A smart contract pays exactly what was approved, once, and the receipt is matched back.", detail: "Today this runs in simulation or on Arc testnet with test USDC: no real money moves." },
];

const audiences = [
  { title: "US businesses paying remote contractors", body: "Hourly, salaried or fixed-retainer contractors across borders, without spreadsheet guesswork." },
  { title: "Payroll and finance leads", body: "Controllers and heads of finance who need to explain every payroll number to an auditor." },
  { title: "Payroll bureaus and accounting firms", body: "Teams running payroll for many clients who need consistent rules and a clean audit trail." },
  { title: "Founders and operations", body: "Small teams where payroll is one job among many and mistakes are expensive." },
];

const proofs = [
  { title: "The rule cites its sentence", body: "Each pay rule points back to the policy clause it came from, with the approved version.", visual: <PolicyRuleVisual /> },
  { title: "The data is reconciled", body: "Timesheets, approvals and pay records are compared before anything is calculated.", visual: <ImportVisual /> },
  { title: "The amount is traced", body: "Deterministic code shows every input, rate and step behind each amount, with the clause it came from.", visual: <TraceVisual /> },
  { title: "Two different people sign", body: "One person approves payroll; another approves payment. Neither can do both.", visual: <ApprovalsVisual /> },
  { title: "The receipt proves it", body: "Payment settles on Arc and is matched back to the obligation it paid.", visual: <ReceiptVisual /> },
];

const chain = ["Policy", "Pay rules", "Validation", "HR approval", "Import", "Reconciliation", "Exceptions", "Calculation trace", "Payroll approval", "Payment plan", "Payment approval", "Arc receipt", "Audit trail"];

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

const ink = "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-[0.375rem] bg-primary px-8 text-base font-medium text-primary-foreground transition-[background-color,transform] duration-200 hover:bg-primary/85 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const outline = "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-[0.375rem] border-[1.5px] border-primary bg-white px-8 text-base font-medium text-foreground transition-[background-color,transform] duration-200 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
const section = "scroll-mt-28 px-5 py-32 sm:px-8 md:py-48";
const h2 = "text-[clamp(2.25rem,4.5vw,4rem)] font-medium leading-[1.04] tracking-[-0.02em]";
const card = "group relative overflow-hidden rounded-[0.5rem] p-7 sm:p-9";
const lift = "transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100";

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
    <main id="main" className="w-full max-w-full overflow-x-hidden">
      {/* React escapes "</script" inside script text, so this needs no raw-HTML injection (S24). */}
      <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      <LandingMotion>
        {/* Attention */}
        <section aria-labelledby="hero-title" className="relative px-5 pb-32 pt-16 sm:px-8 md:pb-48 md:pt-24">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center text-center">
            <h1 id="hero-title" className="w-full max-w-6xl text-balance text-[clamp(2.75rem,6vw,6rem)] font-medium leading-[0.98] tracking-[-0.02em]">
              Payroll that can&apos;t pay the wrong person.
            </h1>
            <p className="mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              AI reads your pay policy and messy timesheets. Plain code does the maths. Two different people approve. A smart contract pays exactly what they approved, in USDC on Arc.
            </p>
            <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
              <a href="#join" className={ink}>Join the waitlist</a>
              <a href="#how-it-works" className={outline}>See how it works</a>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">In development · Arc testnet only, no real funds</p>
          </div>

          <div className="relative mx-auto mt-16 w-full max-w-6xl overflow-hidden rounded-[0.5rem] border border-foreground/10 bg-card p-2 sm:p-4 md:mt-24 md:p-8">
            <div className="relative">
              <RunReviewVisual />
            </div>
          </div>
        </section>

        {/* Interest: the failure modes, as a gapless bento */}
        <section id="problems" aria-labelledby="problems-title" className={section}>
          <div className="mx-auto max-w-7xl">
            <h2 id="problems-title" data-rise className={`${h2} max-w-5xl`}>
              Payroll errors hide in spreadsheets until someone is paid wrong.
            </h2>
            <ul className="mt-16 grid grid-flow-dense grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 md:mt-24">
              <li data-rise className={`${card} bg-card md:col-span-2 md:row-span-2`}>
                <h3 className="text-3xl font-medium tracking-[-0.02em] sm:text-4xl">Hours that don&apos;t add up</h3>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">Missed, unapproved or duplicated timesheet hours slip into pay. Kleeno flags each one with the rows that prove it.</p>
                <div className={`mt-10 ${lift}`}>
                  <HoursCheckVisual />
                </div>
              </li>
              <li data-rise className={`${card} bg-ink text-white md:col-span-2`}>
                <h3 className="text-2xl font-medium tracking-[-0.02em] sm:text-3xl">Paying the wrong person</h3>
                <p className="mt-3 max-w-lg leading-relaxed text-white/75">A changed wallet looks like any other row. Kleeno holds it until a second person confirms the new recipient.</p>
                <div className={`mt-8 ${lift}`}>
                  <WalletChangeVisual />
                </div>
              </li>
              <li data-rise className={`${card} bg-white`}>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Rules in formulas</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">Overtime and rates nobody can explain when a number is questioned.</p>
                <div className={`mt-6 ${lift}`}>
                  <PolicyRuleVisual compact />
                </div>
              </li>
              <li data-rise className={`${card} bg-white`}>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Answers after payday</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">Every amount carries its own working, before you sign.</p>
                <div className={`mt-6 ${lift}`}>
                  <TraceVisual compact />
                </div>
              </li>
            </ul>
          </div>
        </section>

        {/* Interest: the real pipeline as a typographic marquee */}
        <div className="border-y border-foreground/10 py-8" role="region" aria-label="The Kleeno chain">
          <p className="sr-only">{chain.join(", then ")}.</p>
          <div aria-hidden className="overflow-hidden">
            <div data-marquee className="flex w-max gap-10 whitespace-nowrap pr-10 text-[clamp(1.75rem,3.5vw,3rem)] font-medium tracking-[-0.02em]">
              {[...chain, ...chain].map((c, i) => (
                <span key={i} className="flex items-center gap-10">
                  {c}
                  <span aria-hidden className="size-2 rounded-[0.125rem] bg-foreground/30" />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Interest: how it works, horizontal accordion */}
        <section id="how-it-works" aria-labelledby="how-title" className={section}>
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <h2 id="how-title" data-rise className={h2}>
                From pay policy to an explained, approved payroll.
              </h2>
              <p data-rise className="max-w-md text-lg leading-relaxed text-muted-foreground">
                AI understands. Evidence grounds. Validation verifies. People approve. Deterministic code executes. The audit trail proves it.
              </p>
            </div>
            <div className="mt-16 md:mt-24">
              <LandingSteps steps={steps} />
            </div>
          </div>
        </section>

        {/* Desire: pinned split, the verified chain */}
        <section id="proof" aria-labelledby="proof-title" className={`${section} bg-card`}>
          <div data-pin-section className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-[1fr_1.15fr] lg:gap-24">
            <div data-pin className="lg:self-start">
              <h2 id="proof-title" className={h2}>
                Every number carries its proof.
              </h2>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
                From the sentence in your policy to the receipt on Arc, each step links to the one before it. Ask “why this amount?” and the answer is already written down.
              </p>
            </div>
            <ol className="space-y-6">
              {proofs.map((p) => (
                <li key={p.title} data-proof className={`${card} bg-white`}>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] sm:text-3xl">{p.title}</h3>
                  <p className="mt-3 max-w-lg leading-relaxed text-muted-foreground">{p.body}</p>
                  <div className={`mt-8 ${lift}`}>{p.visual}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Desire: scrubbed principles statement */}
        <section id="safety" aria-labelledby="safety-title" className={section}>
          <div className="mx-auto max-w-6xl">
            <h2 id="safety-title" className="sr-only">Safety</h2>
            <p data-scrub className="text-[clamp(2rem,4.6vw,4.25rem)] font-medium leading-[1.08] tracking-[-0.02em]">
              <ScrubWords text="AI proposes. You decide. Plain code calculates. The contract pays only what two different people approved, and every step is on record." />
            </p>
            <ul className="mt-20 grid gap-10 md:grid-cols-3 md:mt-28">
              <li data-rise>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">AI never sets an amount</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">It proposes rules and flags issues. Deterministic code calculates, and the same inputs always give the same result.</p>
              </li>
              <li data-rise>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Two people, two approvals</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">One person approves payroll; a different person approves payment. Nothing is paid behind your back.</p>
              </li>
              <li data-rise>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Names stay in your browser</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  Imports replace names with worker codes before upload. Read exactly what we store in the{" "}
                  <a href="/privacy" className="font-medium text-foreground underline underline-offset-4 hover:no-underline">privacy note</a>.
                </p>
              </li>
            </ul>
          </div>
        </section>

        {/* Who it's for, with inline pill renderings inside the heading */}
        <section id="who-its-for" aria-labelledby="who-title" className={`${section} pt-0 md:pt-0`}>
          <div className="mx-auto max-w-7xl">
            <h2 id="who-title" data-rise className={`${h2} max-w-5xl`}>
              Built for the people <InlinePill variant="signers" /> who answer for payroll <InlinePill variant="trace" /> line by line.
            </h2>
            <ul className="mt-16 border-t border-foreground/15 md:mt-24">
              {audiences.map((a) => (
                <li key={a.title} data-rise className="group grid gap-3 border-b border-foreground/15 py-8 transition-colors duration-300 hover:bg-card md:grid-cols-[1.2fr_1fr] md:gap-12 md:px-6">
                  <h3 className="text-2xl font-medium tracking-[-0.02em] transition-transform duration-500 ease-out group-hover:translate-x-2 motion-reduce:transition-none sm:text-3xl">{a.title}</h3>
                  <p className="text-lg leading-relaxed text-muted-foreground">{a.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className={`${section} pt-0 md:pt-0`}>
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1fr_1.4fr]">
            <h2 id="faq-title" data-rise className={h2}>Questions, answered plainly.</h2>
            <div className="space-y-3">
              {faqs.map((f) => (
                <FaqItem key={f.q} question={f.q} answer={f.a} />
              ))}
            </div>
          </div>
        </section>

        {/* Action */}
        <section id="join" aria-labelledby="join-title" className="scroll-mt-28 px-3 pb-8 sm:px-6">
          <div className="relative mx-auto max-w-[90rem] overflow-hidden rounded-[0.5rem] bg-ink px-6 py-20 text-white sm:px-12 md:py-32 lg:px-20">
            <div className="relative grid items-center gap-14 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <h2 id="join-title" className="text-[clamp(2.5rem,6vw,5.5rem)] font-medium leading-[0.98] tracking-[-0.02em]">
                  Be first to run a payroll you can explain.
                </h2>
                <p className="mt-8 max-w-lg text-lg leading-relaxed text-white/75">
                  Join the waitlist for launch news, pricing and early-access offers. One email field; unsubscribe any time.
                </p>
              </div>
              <div className="rounded-[0.5rem] bg-card p-7 text-foreground sm:p-10">
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Join the waitlist</h3>
                <p className="mb-6 mt-2 text-muted-foreground">Be first to try Kleeno when it opens.</p>
                <WaitlistForm />
              </div>
            </div>
          </div>
        </section>
      </LandingMotion>
    </main>
  );
}
