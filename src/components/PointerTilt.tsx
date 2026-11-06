'use client';

import { useEffect } from 'react';

/**
 * The pointer's place over whatever says `data-tilt`, as custom properties the stylesheet reads:
 * --mx and --my from 0 to 100%, --tx and --ty from -1 to 1. Renders nothing and holds no data.
 * CSS cannot read a pointer, so this is the one thing here that has to be a script. One listener
 * for the document, one write a frame, none at all on a touch screen or under reduced motion, and
 * nothing depends on it: with no script every surface stands at its rest position.
 */
export function PointerTilt() {
  useEffect(() => {
    if (!matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const clear = (el: HTMLElement) => {
      for (const name of ['--mx', '--my', '--tx', '--ty']) el.style.removeProperty(name);
    };
    const paint = () => {
      frame = 0;
      if (!last) return;
      const target = last.target instanceof Element ? last.target : null;
      const el = target?.closest<HTMLElement>('[data-tilt]') ?? null;
      if (el !== current && current) clear(current);
      current = el;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (last.clientX - box.left) / box.width));
      const y = Math.min(1, Math.max(0, (last.clientY - box.top) / box.height));
      el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      el.style.setProperty('--tx', (x * 2 - 1).toFixed(3));
      el.style.setProperty('--ty', (y * 2 - 1).toFixed(3));
    };
    const move = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    // Out of the window, nothing is under the pointer any more, so nothing stays tilted.
    const leave = () => {
      last = null;
      if (current) clear(current);
      current = null;
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
