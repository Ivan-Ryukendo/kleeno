import type { Metadata } from "next";
import Link from "next/link";
import { CONSENT_VERSION } from "@/core/growth";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Kleeno stores when you join the waitlist, why, for how long, and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const contact = env.CONTACT_EMAIL;
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 pb-12 pt-16">
      <p className="text-sm font-bold uppercase tracking-[0.04em]">
        <span aria-hidden className="mr-2 inline-block size-2 rounded-full bg-signal align-middle" />
        Privacy
      </p>
      <h1 className="mt-4 text-5xl font-medium tracking-[-0.02em]">What happens to your data</h1>
      <p className="mt-4 text-lg text-muted-foreground">Plain words, no small print. Version {CONSENT_VERSION}.</p>

      <div className="mt-12 space-y-10 text-lg leading-relaxed [&_h2]:text-2xl [&_h2]:font-medium [&_h2]:tracking-[-0.02em] [&_li]:mt-2 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
        <section>
          <h2>What we store when you join the waitlist</h2>
          <ul>
            <li>Your email address (required).</li>
            <li>Anything you choose to add: role, company name, team size, and your answers to the short survey.</li>
            <li>How you found us: the referring website&apos;s name and campaign tags in the link (for example utm_source).</li>
            <li>When you joined and which version of the consent text you agreed to.</li>
          </ul>
          <p>We do not ask for, and you should not send us, payroll files, worker names, salaries, bank details or wallet addresses through the waitlist.</p>
        </section>

        <section>
          <h2>Why</h2>
          <ul>
            <li>To email you when Kleeno is ready to try, including pricing and any early-access offer. That is what you agreed to.</li>
            <li>To contact you about a short call, only if you said yes to one.</li>
            <li>To understand which payroll problems matter most and what teams would pay, so we build the right thing.</li>
          </ul>
          <p>We never sell or share your details for anyone else&apos;s marketing. Survey answers about budget are research, not an order or a commitment.</p>
        </section>

        <section>
          <h2>Where it lives</h2>
          <p>
            The waitlist is stored in our database at Supabase and the site is hosted on Vercel. Data travels only over HTTPS. Only Kleeno team members with a password and a second sign-in factor can see the list.
          </p>
        </section>

        <section>
          <h2>How long we keep it</h2>
          <p>Until Kleeno launches plus 12 months, or until you ask us to delete it, whichever comes first. Deletion removes your entry and survey answers; database backups age out on the provider&apos;s schedule.</p>
        </section>

        <section>
          <h2>Site analytics</h2>
          <p>
            We count visits with Vercel Web Analytics. It uses no cookies, does not follow you to other sites, and gives us totals only (pages viewed, referring site, country, device type). It runs on the public pages only.
          </p>
        </section>

        <section>
          <h2>Your choices</h2>
          <p>
            {contact ? (
              <>
                To unsubscribe, correct or delete your entry, email{" "}
                <a href={`mailto:${contact}`} className="underline underline-offset-4">
                  {contact}
                </a>{" "}
                from the address you signed up with. We act on requests within 30 days.
              </>
            ) : (
              <>To unsubscribe, correct or delete your entry, reply to any email we send you. A direct contact address will be listed here before our first email.</>
            )}
          </p>
        </section>

        <section>
          <h2>When Kleeno itself launches</h2>
          <p>
            The product is designed so the most sensitive payroll data never reaches us: worker names are removed in your browser before upload, pay and policy fields are encrypted per company, and real-company users sign in with a second factor. A full data note will come with the product.
          </p>
        </section>
      </div>

      <p className="mt-14">
        <Link href="/#join" className="inline-flex h-12 items-center rounded-[1.25rem] bg-primary px-7 text-base font-medium text-primary-foreground hover:bg-primary/85">
          Back to the waitlist
        </Link>
      </p>
    </main>
  );
}
