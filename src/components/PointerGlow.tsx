'use client';

import { useEffect } from 'react';

/** The surfaces that carry a light under the pointer (globals.css, `--gx`). */
const LIT = '.type-card, .rows > li, .trace, .search, .facts';

/**
 * Holds no state and renders nothing. It tells the card under a mouse or pen
 * where the pointer is, as four custom properties on that card: `--gx`/`--gy`
 * in pixels from its corner, for the light and the border that follow the
 * pointer, and `--nx`/`--ny` from -0.5 to 0.5, for the type cards' tilt. What
 * those look like is the stylesheet's, including that the tilt does not exist
 * under prefers-reduced-motion. A touch has no hover to light, so touch
 * pointers are skipped here.
 *
 * A client component because CSS has no pointer coordinates: `:hover` says
 * which card, never where on it, and a light that follows the pointer is the
 * one thing Phase 74's cards needed that a stylesheet cannot express.
 *
 * One listener for the whole document rather than one per card, and at most
 * one write per animation frame. Nothing re-renders: React never sees the
 * pointer. With JavaScript off, or before this runs, a hovered card lights from
 * its centre — the properties' fallbacks — and nothing else changes.
 */
export function PointerGlow() {
  useEffect(() => {
    let frame = 0;
    let last: PointerEvent | null = null;

    function paint() {
      frame = 0;
      const card = (last?.target as Element | null)?.closest?.<HTMLElement>(LIT);
      if (!last || !card) return;
      const box = card.getBoundingClientRect();
      const x = last.clientX - box.left;
      const y = last.clientY - box.top;
      card.style.setProperty('--gx', `${x}px`);
      card.style.setProperty('--gy', `${y}px`);
      card.style.setProperty('--nx', (x / box.width - 0.5).toFixed(3));
      card.style.setProperty('--ny', (y / box.height - 0.5).toFixed(3));
    }

    function onMove(event: PointerEvent) {
      if (event.pointerType === 'touch') return;
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    }

    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
