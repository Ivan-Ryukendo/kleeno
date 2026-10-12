"use client";

import { useEffect, useRef } from "react";

// Landing-page motion only (DESIGN.md §13: gsap is approved for public pages, never for app-theme screens or money/approval surfaces).
// gsap and ScrollTrigger are loaded with dynamic import() after hydration, so they stay out of the initial bundle.
// The markup is server-rendered and fully visible without JavaScript; every tween below runs only when the visitor
// has not asked for reduced motion, so `prefers-reduced-motion: reduce` gets the same static page (no pin, no scrub).
// Hooks are data attributes so the sections stay server components:
//   data-rise            fades in and rises once when it enters
//   data-marquee         a track with its content duplicated once; loops left
//   data-pin-section     container; its [data-pin] child pins on wide screens while [data-proof] cards scroll past
//   data-proof           scales 0.92 -> 1 and fades in entering; fades gently (opacity only) leaving
//   data-scrub           paragraph whose [data-word] spans scrub from 0.12 to 1 opacity
export function LandingMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const [{ default: gsap }, { ScrollTrigger }] = await Promise.all([import("gsap"), import("gsap/ScrollTrigger")]);
      if (cancelled || !scope.current) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(scope);

        q("[data-rise]").forEach((el) => {
          gsap.from(el, { y: 32, opacity: 0, duration: 0.9, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
        });

        q("[data-marquee]").forEach((el) => {
          gsap.to(el, { xPercent: -50, ease: "none", duration: 48, repeat: -1 });
        });

        // Opacity + scale only, with explicit start values on both legs. (A filter tween from the computed "none" starts at
        // brightness(0) in GSAP, which rendered whole cards solid black mid-scroll; never tween filter here.)
        q("[data-proof]").forEach((el) => {
          gsap
            .timeline({ scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.5, invalidateOnRefresh: true } })
            .fromTo(el, { scale: 0.92, opacity: 0.45 }, { scale: 1, opacity: 1, ease: "power2.out", duration: 0.4, immediateRender: false })
            .to(el, { duration: 0.35 })
            .fromTo(el, { scale: 1, opacity: 1 }, { scale: 0.97, opacity: 0.55, ease: "power1.in", duration: 0.25, immediateRender: false });
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

      // Web fonts change heights after first layout; re-measure so pin and card ranges match the final page.
      document.fonts?.ready.then(() => ScrollTrigger.refresh());

      cleanup = () => mm.revert();
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

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
