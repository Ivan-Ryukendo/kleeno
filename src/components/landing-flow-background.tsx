"use client";

import { useEffect, useRef } from "react";

// "Flow" background for the public landing page only (owner decision 2026-10-16, preview option A; DESIGN.md §13).
// Thin contour lines drift in the side margins and ripple under the pointer; an orange laser rides one wave line and
// moves with scroll. The centre stays clear so the headline reads. Decorative: aria-hidden, no pointer events, no text.
// Under prefers-reduced-motion it paints one still frame and never animates. Never used on working screens or money surfaces.
const TAU = Math.PI * 2;
const ORANGE = "243,115,56";
const INK = "20,20,19";
const STEP = 30;
const TRAIL = 280;

type Pt = { x: number; y: number };
type Head = Pt & { k: number };
type Beam = { pts: Pt[]; rev?: boolean };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mod = (a: number, n: number) => ((a % n) + n) % n;

export function FlowBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    const layer = document.createElement("canvas");
    const L = layer.getContext("2d");
    if (!cv || !ctx || !L) return;

    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let still = motion.matches;
    let W = 0;
    let H = 0;
    let maskGrad: CanvasGradient | null = null;
    let raf = 0;
    let last = performance.now();
    const S = { t: 0, sy: 0, px: -1, py: -1, strength: 0.2, d1: 0.78, gain: 1, boost: 0, phase: [0, 0], heads: [] as (Head | null)[] };

    const hotAmt = (x: number, y: number) => (S.px > -1 ? Math.exp(-((x - S.px) ** 2 + (y - S.py) ** 2) / (2 * 150 * 150)) : 0);
    const waveY = (j: number, x: number, base: number) =>
      base + 9 * Math.sin(x * 0.01 + j * 0.55 + S.t * 0.45) + 5 * Math.sin(x * 0.026 - j * 0.7 + S.t * 0.8) + 16 * hotAmt(x, base) * Math.sin(x * 0.045 - S.t * 3);

    function spots() {
      const s: [number, number, number, number][] = [];
      if (S.px > -1) s.push([S.px, S.py, 240, 0.75]);
      for (const h of S.heads) if (h) s.push([h.x, h.y, 150, 0.7 * 0.75 * h.k]);
      return s;
    }
    // Ink first, then the same path again in orange through soft spotlights at the pointer and at each laser head.
    function paint(path: Path2D, lw: number, a: number) {
      if (!L) return;
      L.lineWidth = lw;
      L.lineJoin = "round";
      L.lineCap = "round";
      L.strokeStyle = `rgba(${INK},${(S.strength * a).toFixed(3)})`;
      L.stroke(path);
      for (const [x, y, r, k] of spots()) {
        const g = L.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(${ORANGE},${k})`);
        g.addColorStop(1, `rgba(${ORANGE},0)`);
        L.strokeStyle = g;
        L.lineWidth = lw + 0.6;
        L.stroke(path);
      }
    }
    function drawLines() {
      if (!L) return;
      const o = S.sy * 0.08;
      const j0 = Math.floor(o / STEP) - 1;
      const n = Math.ceil(H / STEP) + 4;
      const thin = new Path2D();
      const bold = new Path2D();
      for (let j = j0; j < j0 + n; j++) {
        const base = j * STEP - o;
        const P = j % 5 === 0 ? bold : thin;
        for (let x = -10; x <= W + 10; x += 10) {
          const y = waveY(j, x, base);
          if (x === -10) P.moveTo(x, y);
          else P.lineTo(x, y);
        }
      }
      paint(thin, 1, 1);
      paint(bold, 1.7, 1.25);
    }
    function beams(): Beam[] {
      const o = S.sy * 0.08;
      const mk = (fy: number): Pt[] => {
        const j = Math.round((fy * H + o) / STEP);
        const base = j * STEP - o;
        const pts: Pt[] = [];
        for (let x = -10; x <= W + 10; x += 10) pts.push({ x, y: waveY(j, x, base) });
        return pts;
      };
      return [{ pts: mk(0.46) }, { pts: mk(0.82), rev: true }];
    }

    const dim = (x: number) => {
      const d = Math.abs(x - W / 2) / (W / 2);
      const t = clamp((d - (S.d1 - 0.32)) / 0.32, 0, 1);
      return 0.3 + 0.7 * t * t * (3 - 2 * t);
    };
    function drawBeam(def: Beam, i: number) {
      if (!ctx) return;
      const pts = def.rev ? def.pts.slice().reverse() : def.pts;
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
      const total = cum[cum.length - 1];
      const at = (s: number): Pt => {
        const c = clamp(s, 0, total);
        let k = 1;
        while (k < cum.length - 1 && cum[k] < c) k++;
        const f = (c - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
        return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f };
      };
      const cycle = total + TRAIL + 200;
      const s = mod(S.phase[i] + S.sy * 0.8 + i * cycle * 0.5, cycle) - 100;
      const edge = clamp((s + 40) / 120, 0, 1) * clamp((total + 40 - s) / 120, 0, 1);
      const N = 34;
      ctx.lineCap = "round";
      for (let k = 0; k < N; k++) {
        const sa = s - (TRAIL * k) / N;
        const sb = s - (TRAIL * (k + 1)) / N;
        if (sa < 0 || sb > total) continue;
        const pa = at(sa);
        const pb = at(sb);
        const f = 1 - k / N;
        const al = S.gain * 0.75 * Math.pow(f, 1.8) * dim(pa.x);
        ctx.shadowColor = `rgba(${ORANGE},${al * 0.9})`;
        ctx.shadowBlur = 14 * f + 2;
        ctx.strokeStyle = `rgba(${ORANGE},${al})`;
        ctx.lineWidth = 0.8 + 2.4 * f;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (s >= 0 && s <= total) {
        const h = at(s);
        const k = S.gain * edge * 0.75 * dim(h.x);
        const g = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 20);
        g.addColorStop(0, `rgba(255,214,184,${k})`);
        g.addColorStop(0.3, `rgba(${ORANGE},${k * 0.75})`);
        g.addColorStop(1, `rgba(${ORANGE},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 20, 0, TAU);
        ctx.fill();
        S.heads[i] = { x: h.x, y: h.y, k: edge * dim(h.x) };
      } else S.heads[i] = null;
    }

    function buildMask() {
      if (!L) return;
      const g = L.createLinearGradient(0, 0, W, 0);
      const full = 0.5 - 0.5 * S.d1;
      const zero = 0.5 - 0.5 * (S.d1 - 0.32);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(clamp(full, 0, 0.5), "rgba(0,0,0,1)");
      g.addColorStop(clamp(zero, 0, 0.5), "rgba(0,0,0,0)");
      g.addColorStop(clamp(1 - zero, 0.5, 1), "rgba(0,0,0,0)");
      g.addColorStop(clamp(1 - full, 0.5, 1), "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      maskGrad = g;
    }
    function render() {
      if (!cv || !ctx || !L) return;
      L.clearRect(0, 0, W, H);
      drawLines();
      if (maskGrad) {
        L.save();
        L.globalCompositeOperation = "destination-in";
        L.fillStyle = maskGrad;
        L.fillRect(0, 0, W, H);
        L.restore();
      }
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(layer, 0, 0, W, H);
      if (still) S.heads = [];
      else {
        S.heads = [];
        beams().forEach(drawBeam);
      }
    }
    function resize() {
      if (!cv || !ctx || !L) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      for (const c of [cv, layer]) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Phones have almost no side margin: spread thinner and fainter lines across more of the width.
      const narrow = W < 768;
      S.strength = narrow ? 0.1 : 0.2;
      S.d1 = narrow ? 0.4 : 0.78;
      S.gain = narrow ? 0.4 : 1; // the laser would otherwise cross the headline on a phone
      buildMask();
      if (still) render();
    }
    function frame(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      S.t += dt;
      S.boost *= Math.pow(0.15, dt);
      for (let i = 0; i < 2; i++) S.phase[i] += dt * (80 + 150 * S.boost);
      S.sy = window.scrollY;
      render();
      raf = requestAnimationFrame(frame);
    }
    function start() {
      cancelAnimationFrame(raf);
      still = motion.matches;
      S.px = S.py = -1;
      S.t = 0;
      S.sy = 0;
      if (still) render();
      else {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    }
    const onMove = (e: PointerEvent) => {
      if (still) return;
      S.px = e.clientX;
      S.py = e.clientY;
      S.boost = Math.min(S.boost + 1.1, 6);
    };
    const onLeave = () => {
      S.px = S.py = -1;
    };

    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    motion.addEventListener("change", start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      motion.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={ref} aria-hidden data-flow-background className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
