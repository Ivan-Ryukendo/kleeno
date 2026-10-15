import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist-form";
import { GlowSurface } from "@/components/glow-surface";
import { FaqItem } from "@/components/landing-faq";
import { FlowBackground } from "@/components/landing-flow-background";
import { LandingMotion, ScrubWords } from "@/components/landing-motion";
import { LandingSteps, type LandingStep } from "@/components/landing-steps";
import { PayrollDemo } from "@/components/landing-payroll-demo";
import {
  ApprovalsVisual,
  HoursCheckVisual,
  ImportVisual,
  InlinePill,
  PolicyRuleVisual,
  ReceiptVisual,
  TraceVisual,
  WalletChangeVisual,
} from "@/components/landing-visuals";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { absolute: "Kleeno · AI payroll that measures every hire and shows its working" },
  alternates: { canonical: "/" },
  // A page-level openGraph replaces the layout's, so repeat the site fields and name the share card (app/opengraph-image.tsx) here.
  openGraph: { url: "/", siteName: "Kleeno", type: "website", locale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Kleeno: AI payroll that measures every hire and shows its working" }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

const steps: LandingStep[] = [
  { title: "Read", body: "Give Kleeno your pay policy and records. AI turns them into structured rules, each linked to its source.", detail: "Policies and CSV timesheets or pay data today; more systems connect next. Nothing applies until an approver accepts it." },
  { title: "Measure", body: "Kleeno reconciles every record against your rules and approvals, and flags each mismatch with the rows that show it.", detail: "Names become worker codes in your browser before upload. People resolve each exception." },
  { title: "Calculate", body: "Fixed rules, not AI, work out each amount. The same inputs always give the same result, and every amount shows its working.", detail: "Each line records its source, rule, version and step. Payroll approval asks for your password again." },
  { title: "Approve and pay", body: "A different person approves payment. It is paid exactly as approved, then matched back to the record.", detail: "Today this runs in simulation or on Arc testnet with test USDC. No real money moves." },
];

const audiences = [
  { title: "Recruiters and staffing agencies", body: "Pay placed talent on the rules, with a record of how each amount was reached." },
  { title: "Payroll and accounting firms", body: "Run many clients to one standard, with a clean trail for each." },
  { title: "Finance and HR leads", body: "Explain any payroll number to an auditor, a manager or a worker." },
  { title: "Founders and operations teams", body: "Payroll is one job among many. Kleeno does the measuring, so you only approve." },
];

const proofs = [
  { title: "The rule cites its sentence", body: "Each pay rule points back to the policy clause it came from, with the approved version.", visual: <PolicyRuleVisual /> },
  { title: "Every source is reconciled", body: "Timesheets, approvals and pay records are measured against each other before anything is calculated.", visual: <ImportVisual /> },
  { title: "The amount explains itself", body: "Fixed rules show every input, rate and step behind each amount, with the clause it came from.", visual: <TraceVisual /> },
  { title: "Two different people sign", body: "One person approves payroll; another approves payment. Neither can do both.", visual: <ApprovalsVisual /> },
  { title: "The receipt closes the loop", body: "Payment settles on Arc and is matched back to the obligation it paid. The result stays on record for the next period.", visual: <ReceiptVisual /> },
];

const chain = ["Policy", "Pay rules", "Validation", "HR approval", "Import", "Reconciliation", "Exceptions", "Calculation trace", "Payroll approval", "Payment plan", "Payment approval", "Arc receipt", "Audit trail"];

const faqs = [
  { q: "What is Kleeno?", a: "Kleeno is AI-assisted payroll that measures, then pays. It reads your pay policy and records, turns them into structured rules, reconciles the data, calculates each amount with fixed rules, and explains every result line by line." },
  { q: "Is Kleeno available now?", a: "Not yet. Kleeno is in development. Joining the waitlist gets you updates and a chance at early access; it does not guarantee access." },
  { q: "Does the AI calculate pay?", a: "No. AI reads your policy and messy data and proposes rules and flags. Plain, deterministic code does every calculation, and a person approves the result. The AI never sets an amount or approves anything." },
  { q: "What sources can Kleeno read?", a: "Today: pay policies you paste, and CSV imports of timesheets and pay data. More systems are planned. Every source is treated as evidence, never as an authority." },
  { q: "Can I see why an amount is what it is?", a: "Yes. Every amount records its source, the rule and version applied, its inputs and each step, so you can open it and read the working." },
  { q: "Can Kleeno get a calculation wrong?", a: "Calculations are deterministic: the same inputs and approved rules always give the same result, and the working is recorded so any figure can be checked. Results are only as good as the rules and data people approve, which is why people approve both." },
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
      <FlowBackground />
      <LandingMotion>
        {/* Attention */}
        <section aria-labelledby="hero-title" className="relative px-5 pb-32 pt-16 sm:px-8 md:pb-48 md:pt-24">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center text-center">
            <h1 id="hero-title" className="w-full max-w-6xl text-balance text-[clamp(2.75rem,6vw,6rem)] font-medium leading-[0.98] tracking-[-0.02em]">
              AI that reads every source, measures every hire, and shows its working.
            </h1>
            <p className="mt-8 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Kleeno turns your policies, timesheets and pay records into a calculated, traceable payroll, then pays exactly what you approve. AI understands the data. Fixed rules do the maths.
            </p>
            <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
              <a href="#join" className={ink}>Join the waitlist</a>
              <a href="#how-it-works" className={outline}>See how it works</a>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">In development · Arc testnet only, no real funds</p>
          </div>

          <GlowSurface className="mx-auto mt-16 w-full max-w-6xl rounded-[0.75rem] p-2 sm:p-4 md:mt-24 md:p-10">
            <PayrollDemo />
          </GlowSurface>
          <p className="mx-auto mt-4 max-w-6xl text-center text-sm text-muted-foreground">
            Interactive preview with sample data. Open Workflow to see where each figure came from.
          </p>
        </section>

        {/* Interest: the failure modes, as a gapless bento */}
        <section id="problems" aria-labelledby="problems-title" className={section}>
          <div className="mx-auto max-w-7xl">
            <h2 id="problems-title" data-rise className={`${h2} max-w-5xl`}>
              Pay is only as good as the way it&apos;s measured.
            </h2>
            <ul className="mt-16 grid grid-flow-dense grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 md:mt-24">
              <li data-rise className={`${card} bg-card md:col-span-2 md:row-span-2`}>
                <h3 className="text-3xl font-medium tracking-[-0.02em] sm:text-4xl">Hours, measured against approvals</h3>
                <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">Missed, duplicate or unapproved hours are caught before calculation, each with the rows that show why.</p>
                <div className={`mt-10 ${lift}`}>
                  <HoursCheckVisual />
                </div>
              </li>
              <li data-rise className="md:col-span-2">
                <GlowSurface strength="soft" className={`${card} h-full text-white`}>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] sm:text-3xl">Recipients, confirmed</h3>
                  <p className="mt-3 max-w-lg leading-relaxed text-white/75">A changed payment detail is held until a second person confirms it.</p>
                  <div className={`mt-8 ${lift}`}>
                    <WalletChangeVisual />
                  </div>
                </GlowSurface>
              </li>
              <li data-rise className={`${card} bg-white`}>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Rules, in plain sight</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">Every rate and overtime rule links to the policy sentence it came from.</p>
                <div className={`mt-6 ${lift}`}>
                  <PolicyRuleVisual compact />
                </div>
              </li>
              <li data-rise className={`${card} bg-white`}>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">Answers before payday</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">Every amount carries its working before anyone signs.</p>
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
                One loop, every pay period: read, measure, calculate, pay.
              </h2>
              <p data-rise className="max-w-md text-lg leading-relaxed text-muted-foreground">
                AI understands. Evidence grounds. Validation checks. People approve. Fixed rules calculate. The audit trail proves it.
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
                Every amount can answer “why?”
              </h2>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
                From the sentence in your policy to the receipt on Arc, each step links to the one before it. Open any amount and see where it came from, which rule produced it, and who approved it.
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
              <ScrubWords text="AI reads and proposes. Fixed rules calculate. Two different people approve. Every step, and every “why”, is on record." />
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
          <GlowSurface className="mx-auto max-w-[90rem] rounded-[0.75rem] px-6 py-20 text-white sm:px-12 md:py-32 lg:px-20">
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
          </GlowSurface>
        </section>
      </LandingMotion>
    </main>
  );
}
