"use client";

import { useEffect, type RefObject } from "react";

// Hold Space and drag to scroll a region, like Photoshop. The view never moves just because the mouse moves.
// - Space only counts while the pointer is over the region, so Space still scrolls the rest of the page.
// - The middle mouse button also pans. With `backgroundPan`, dragging empty space (an element marked data-pan="bg") pans too,
//   and a tap on it (no drag) calls `onBackgroundTap`.
// - While the region is being panned the pointer events stop here, so decorative pointer-follow effects further up stay still.
// The element gets data-space="true" while Space is held and data-panning="true" while dragging, for cursor styling.
export function useSpacePan(ref: RefObject<HTMLElement | null>, opts: { backgroundPan?: boolean; onBackgroundTap?: () => void } = {}) {
  const { backgroundPan = false, onBackgroundTap } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hover = false;
    let space = false;
    let drag: { x: number; y: number; id: number; bg: boolean } | null = null;
    let moved = 0;

    const isField = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const reset = () => {
      space = false;
      drag = null;
      delete el.dataset.space;
      delete el.dataset.panning;
    };

    const onEnter = () => { hover = true; };
    const onLeave = () => { hover = false; };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !hover || isField(e.target)) return;
      e.preventDefault();
      space = true;
      el.dataset.space = "true";
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") reset(); };

    const onDown = (e: PointerEvent) => {
      const bg = backgroundPan && e.target instanceof HTMLElement && (e.target === el || e.target.dataset.pan === "bg");
      if (!(space || e.button === 1 || (bg && e.button === 0))) return;
      e.preventDefault();
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId, bg: bg && !space };
      moved = 0;
      el.setPointerCapture(e.pointerId);
      el.dataset.panning = "true";
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      e.stopPropagation();
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      el.scrollLeft -= dx;
      el.scrollTop -= dy;
      moved += Math.abs(dx) + Math.abs(dy);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const tap = drag.bg && moved < 4;
      drag = null;
      delete el.dataset.panning;
      if (tap) onBackgroundTap?.();
    };
    // A pan must never count as a click on a cell or step underneath.
    const onClick = (e: MouseEvent) => {
      if (moved > 3 || space) {
        e.stopPropagation();
        e.preventDefault();
        moved = 0;
      }
    };

    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
    };
  }, [ref, backgroundPan, onBackgroundTap]);
}

/** Tailwind classes for a pannable region: hand cursor while Space is held, closed hand while dragging. */
export const panClasses = "data-[space=true]:cursor-grab data-[space=true]:select-none data-[panning=true]:cursor-grabbing";
