"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// Landing-page motion only (DESIGN.md §10: orbit/scroll motion is allowed on the landing page, never on working screens).
// The markup is server-rendered and fully visible without JavaScript; every tween below runs only when the visitor
// has not asked for reduced motion, so `prefers-reduced-motion: reduce` gets the same static page (no pin, no scrub).
// Hooks are data attributes so the sections stay server components:
//   data-rise            fades in and rises once when it enters
//   data-hero-frame      the hero media frame settles in on load
//   data-marquee         a track with its content duplicated once; loops left
//   data-pin-section     container; its [data-pin] child pins on wide screens while [data-proof] cards scroll past
//   data-proof           scales 0.86 -> 1 entering, darkens and fades leaving
//   data-scrub           paragraph whose [data-word] spans scrub from 0.12 to 1 opacity
export function LandingMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(scope);

        q("[data-hero-frame]").forEach((el) => {
          gsap.from(el, { y: 48, scale: 0.94, opacity: 0, duration: 1.2, ease: "power3.out", delay: 0.15 });
        });

        q("[data-rise]").forEach((el) => {
          gsap.from(el, { y: 32, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        });

        q("[data-marquee]").forEach((el) => {
          gsap.to(el, { xPercent: -50, ease: "none", duration: 48, repeat: -1 });
        });

        q("[data-proof]").forEach((el) => {
          gsap
            .timeline({ scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.6 } })
            .fromTo(el, { scale: 0.86, opacity: 0.35 }, { scale: 1, opacity: 1, ease: "power2.out", duration: 0.45 })
            .to(el, { duration: 0.25 })
            .to(el, { scale: 0.96, opacity: 0.2, filter: "brightness(0.85)", ease: "power1.in", duration: 0.3 });
        });

        q("[data-scrub]").forEach((el) => {
          const words = el.querySelectorAll("[data-word]");
          gsap.fromTo(words, { opacity: 0.12 }, { opacity: 1, stagger: 0.08, ease: "none", scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: true } });
        });
      });

      // Pinning only where there is room for a two-column split.
      mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
        gsap.utils.selector(scope)("[data-pin-section]").forEach((section) => {
          const pin = section.querySelector("[data-pin]");
          if (!pin) return;
          ScrollTrigger.create({ trigger: section, start: "top top+=128", end: () => `bottom top+=${128 + (pin as HTMLElement).offsetHeight}`, pin, pinSpacing: false, invalidateOnRefresh: true });
        });
      });

      return () => mm.revert();
    },
    { scope },
  );

  return <div ref={scope}>{children}</div>;
}

/** Splits text into word spans for the scrub reveal; the sentence stays one readable string for assistive tech. */
export function ScrubWords({ text }: { text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((w, i) => (
          <span key={i}>
            <span data-word>{w}</span>{" "}
          </span>
        ))}
      </span>
    </>
  );
}
