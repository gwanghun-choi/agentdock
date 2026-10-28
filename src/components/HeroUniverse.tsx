'use client';

import { useEffect, useRef, useState } from 'react';
import { PauseIcon, PlayIcon } from '@/components/Icon';

/**
 * The hero's picture (Phase 74): the six kinds of artifact as six clusters of
 * points in space around one core, the index, turning slowly, with reads
 * running in along the links. The pointer tilts the camera; pointing at or
 * focusing one of the hero's type chips brings that kind's cluster forward and
 * dims the rest. It says nothing a reader needs — `aria-hidden`, no text — and
 * it holds no data: the geometry is a fixed seed, not the corpus.
 *
 * Why a canvas and a client component, against this codebase's default
 * (CLAUDE.md): Phase 72's server SVG was flat by construction, and the
 * redesign asked for depth that answers the pointer. Measured on 2026-10-28,
 * minified and gzipped, on top of the React this site already ships:
 *
 *     three.js (points + lines scene)      +121.4 KB
 *     @react-three/fiber + three           +232.5 KB
 *     motion (one motion.div)               +41.3 KB
 *     gsap (one tween)                      +27.6 KB
 *     this file                              ~3 KB
 *
 * The whole site's client JavaScript was 182 KB gzipped, so three.js alone
 * would have been +67% for some 250 points that a 2D canvas projects in well
 * under a millisecond a frame. Nothing here is a scene graph, a shader or a
 * timeline, which is what those libraries are for.
 *
 * It is the one continuous motion on the site, so it carries what WCAG 2.2.2
 * asks of motion that lasts past five seconds: a visible pause control, which
 * is remembered for this browser. It also stops on its own whenever the hero is
 * scrolled out of view (IntersectionObserver) or the tab is hidden (the
 * browser stops animation frames), and under prefers-reduced-motion it draws
 * one still frame and runs no loop at all — no turning, no pointer parallax,
 * no control, because there is nothing to pause. `data-state` on the canvas
 * says which of those it is in (e2e/journeys.spec.ts).
 *
 * Before hydration and with JavaScript off the canvas is empty and the hero's
 * CSS light (globals.css, `.hero::after`) is the whole ground. The canvas is
 * absolutely placed, so arriving late shifts nothing.
 */

type Point = { x: number; y: number; z: number; kind: number; size: number };

// The kinds in the hero's chip order (typeFilters.ts), each in the dark
// scheme's badge hue (globals.css, `--hue`). The hero is always the dark stage.
const KINDS = ['skill', 'plugin', 'mcp_server', 'command', 'hook', 'agent'];
const HUES = ['#90b8f5', '#c9a2f0', '#6ed4b8', '#f0b678', '#f293ad', '#a8b6f2'];
const CORE = '#7da7ff';
const PER_KIND = 22;
const DUST = 90;
const STORE = 'agentdock:hero-motion';

/** A fixed seed, so every visit and every server shows the same universe. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build() {
  const rand = random(74);
  const spread = () => (rand() + rand() + rand() - 1.5) * 0.42;
  const points: Point[] = [];
  const edges: [number, number][] = [];
  const hubs: number[] = [];
  KINDS.forEach((_, kind) => {
    const theta = (kind / KINDS.length) * Math.PI * 2;
    const phi = kind % 2 ? 0.42 : -0.32;
    const hub = {
      x: Math.cos(phi) * Math.cos(theta),
      y: Math.sin(phi),
      z: Math.cos(phi) * Math.sin(theta),
    };
    const first = points.length;
    hubs.push(first);
    points.push({ ...hub, kind, size: 3.2 });
    for (let i = 1; i < PER_KIND; i++) {
      points.push({
        x: hub.x + spread(),
        y: hub.y + spread() * 0.8,
        z: hub.z + spread(),
        kind,
        size: 1 + rand() * 1.4,
      });
    }
    // Each point to its two nearest in the same cluster.
    for (let i = first + 1; i < points.length; i++) {
      const near = points
        .map((p, j) => [
          j,
          (p.x - points[i].x) ** 2 + (p.y - points[i].y) ** 2 + (p.z - points[i].z) ** 2,
        ])
        .filter(([j]) => j >= first && j < points.length && j !== i)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2);
      for (const [j] of near) if (!edges.some(([a, b]) => a === j && b === i)) edges.push([i, j]);
    }
  });
  for (let i = 0; i < DUST; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = 1.75 + rand() * 0.45;
    const s = Math.sqrt(1 - u * u) * r;
    points.push({
      x: Math.cos(a) * s,
      y: u * r * 0.7,
      z: Math.sin(a) * s,
      kind: -1,
      size: 0.5 + rand() * 0.8,
    });
  }
  return { points, edges, hubs, rand };
}

/** A soft round light, drawn once per colour and stamped with drawImage:
 *  far cheaper per frame than shadowBlur or a gradient per point. */
function sprite(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return c;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, '#ffffff');
  r.addColorStop(0.12, color);
  r.addColorStop(0.4, `${color}55`);
  r.addColorStop(1, `${color}00`);
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const ease = (t: number) => 1 - (1 - Math.min(1, t)) ** 3;

export function HeroUniverse() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const toggle = useRef<(paused: boolean) => void>(() => {});
  // null until mounted and only when it moves at all: no control is
  // server-rendered, so a reader with JavaScript off is not offered a dead one.
  const [paused, setPaused] = useState<boolean | null>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    const hero = el?.closest('.hero');
    if (!el || !ctx || !hero) return;

    const { points, edges, hubs, rand } = build();
    const lights = HUES.map(sprite);
    const dust = sprite('#9fb3d9');
    const core = sprite(CORE);
    const weight = KINDS.map(() => 1);
    const signals: { path: number[]; t: number }[] = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');

    let width = 0;
    let height = 0;
    let time = 0;
    let last = 0;
    let frame = 0;
    let visible = true;
    let stopped = false;
    let lit = -1;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    try {
      stopped = localStorage.getItem(STORE) === 'paused';
    } catch {}

    function resize() {
      if (!el || !ctx) return;
      // 1.5 at most: the picture is soft light, not type, and its cost is
      // pixels. On a 390px phone at 4x throttling the frames' script was 2.2%
      // of the main thread and the whole canvas 12.6% at a ratio of 1, 32.9%
      // at 2 (headless, software raster; measured 2026-10-28).
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      width = el.clientWidth;
      height = el.clientHeight;
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    /** Where the universe sits: around the Latest read figure where it is
     *  shown; under 64rem, inside the smaller canvas the stylesheet gives it
     *  in the hero's top right corner. */
    function frameOf() {
      if (!el) return { cx: 0, cy: 0, scale: 0 };
      const box = el.getBoundingClientRect();
      const trace = hero?.querySelector('.trace')?.getBoundingClientRect();
      if (trace && trace.width > 0) {
        return {
          cx: trace.left + trace.width / 2 - box.left,
          cy: trace.top + trace.height / 2 - box.top,
          scale: Math.min(trace.height * 0.62, height * 0.5, 330),
        };
      }
      return { cx: width * 0.66, cy: height * 0.4, scale: Math.min(width * 0.5, 170) };
    }

    function draw(dt: number) {
      if (!ctx) return;
      const still = reduce.matches;
      const grow = still ? 1 : ease(time / 1.8);
      // Only while running: a still frame redrawn for a chip (paused, or
      // reduced motion) must not nudge the camera toward the pointer.
      if (dt) {
        pointer.x += (pointer.tx - pointer.x) * 0.06;
        pointer.y += (pointer.ty - pointer.y) * 0.06;
      }
      for (let k = 0; k < weight.length; k++) {
        const goal = lit < 0 ? 1 : k === lit ? 2.6 : 0.25;
        weight[k] = dt ? weight[k] + (goal - weight[k]) * Math.min(1, dt * 7) : goal;
      }

      const { cx, cy, scale } = frameOf();
      const yaw = time * 0.07 + pointer.x * 0.4;
      const pitch = -0.34 + pointer.y * 0.22;
      const cy0 = Math.cos(yaw);
      const sy0 = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const camera = 3.4;
      const project = (x: number, y: number, z: number) => {
        const x1 = x * cy0 - z * sy0;
        const z1 = x * sy0 + z * cy0;
        const y1 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const depth = camera / (camera + z2);
        return { x: cx + x1 * scale * depth, y: cy + y1 * scale * depth, depth };
      };
      const projected = points.map((p) => project(p.x * grow, p.y * grow, p.z * grow));

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 1;

      // Two orbits on the core's plane, inside and outside the clusters: the
      // cue that this is space seen at an angle, not points on a page.
      ctx.strokeStyle = CORE;
      for (const radius of [0.62, 1.32]) {
        ctx.globalAlpha = 0.16 * grow;
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = (i / 96) * Math.PI * 2;
          const q = project(Math.cos(a) * radius * grow, 0, Math.sin(a) * radius * grow);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        }
        ctx.stroke();
      }

      // The links: within a cluster, and each hub to the core. One path per
      // kind and depth band — far, middle, near — rather than a stroke per
      // link: 18 strokes a frame instead of one for each of the links.
      for (let k = 0; k < KINDS.length; k++) {
        for (let band = 0; band < 3; band++) {
          ctx.beginPath();
          for (const [a, b] of edges) {
            if (points[a].kind !== k) continue;
            const d = (projected[a].depth + projected[b].depth) / 2;
            if ((d < 0.92 ? 0 : d < 1.06 ? 1 : 2) !== band) continue;
            ctx.moveTo(projected[a].x, projected[a].y);
            ctx.lineTo(projected[b].x, projected[b].y);
          }
          const d = [0.85, 1, 1.15][band];
          ctx.globalAlpha = Math.min(1, 0.22 * d * d * weight[k] * grow);
          ctx.strokeStyle = HUES[k];
          ctx.stroke();
        }
      }
      hubs.forEach((h, k) => {
        const p = projected[h];
        const g = ctx.createLinearGradient(cx, cy, p.x, p.y);
        g.addColorStop(0, CORE);
        g.addColorStop(1, HUES[k]);
        ctx.globalAlpha = Math.min(1, 0.32 * weight[k] * grow);
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo((cx + p.x) / 2, (cy + p.y) / 2 - scale * 0.18, p.x, p.y);
        ctx.stroke();
      });

      points.forEach((p, i) => {
        const q = projected[i];
        const near = q.depth * q.depth;
        const r = p.size * 5 * near * (p.kind < 0 ? 0.8 : 0.7 + 0.3 * weight[p.kind]);
        if (q.x + r < 0 || q.y + r < 0 || q.x - r > width || q.y - r > height) return;
        ctx.globalAlpha = Math.min(
          1,
          (p.kind < 0 ? 0.45 : 0.9) * near * (p.kind < 0 ? 1 : weight[p.kind]) * grow,
        );
        ctx.drawImage(p.kind < 0 ? dust : lights[p.kind], q.x - r, q.y - r, r * 2, r * 2);
      });

      // The index at the centre.
      ctx.globalAlpha = grow;
      const c = scale * 0.34;
      ctx.drawImage(core, cx - c, cy - c, c * 2, c * 2);

      // Reads running in: from a point, through its hub, to the core.
      if (!still) {
        if (signals.length < 7 && rand() < dt * 2.2) {
          const kind = Math.floor(rand() * KINDS.length);
          const from = hubs[kind] + 1 + Math.floor(rand() * (PER_KIND - 1));
          signals.push({ path: [from, hubs[kind], -1], t: 0 });
        }
        for (let s = signals.length - 1; s >= 0; s--) {
          const sig = signals[s];
          sig.t += dt / 1.6;
          if (sig.t >= 1) {
            signals.splice(s, 1);
            continue;
          }
          const leg = sig.t < 0.5 ? 0 : 1;
          const f = leg ? (sig.t - 0.5) * 2 : sig.t * 2;
          const at = (i: number) => (i < 0 ? { x: cx, y: cy } : projected[i]);
          const a = at(sig.path[leg]);
          const b = at(sig.path[leg + 1]);
          const kind = points[sig.path[0]].kind;
          const r = 7;
          ctx.globalAlpha = Math.sin(sig.t * Math.PI) * weight[kind] * grow;
          ctx.drawImage(
            lights[kind],
            a.x + (b.x - a.x) * f - r,
            a.y + (b.y - a.y) * f - r,
            r * 2,
            r * 2,
          );
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    const state = () => (reduce.matches ? 'still' : stopped ? 'paused' : 'running');

    // ponytail: a fixed 30 fps for an ambient picture. Measured 2026-10-28 at
    // 60 fps: 12.7% of a 1440px desktop's main thread and 47.9% of a 390px
    // phone's at 4x CPU throttling, for a turn of 0.07 rad/s nobody can tell
    // from 30. Revisit if the picture ever moves fast enough to judder.
    function loop(now: number) {
      frame = requestAnimationFrame(loop);
      if (last && now - last < 1000 / 31) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      time += dt;
      draw(dt);
    }

    /** Run the loop only while something can move and somebody can see it;
     *  otherwise leave one frame drawn and stop asking for more. */
    function sync() {
      if (!el) return;
      el.dataset.state = state();
      const run = visible && !stopped && !reduce.matches;
      if (run && !frame) {
        last = 0;
        frame = requestAnimationFrame(loop);
      } else if (!run && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (!frame) {
        // A still frame shows the universe whole, not the entrance's first.
        time = Math.max(time, 1.8);
        draw(0);
      }
      setPaused(reduce.matches ? null : stopped);
    }

    toggle.current = (next) => {
      stopped = next;
      try {
        localStorage.setItem(STORE, next ? 'paused' : 'running');
      } catch {}
      sync();
    };

    function onPointer(event: PointerEvent) {
      if (event.pointerType === 'touch') return;
      pointer.tx = (event.clientX / innerWidth) * 2 - 1;
      pointer.ty = (event.clientY / innerHeight) * 2 - 1;
    }

    /** A type chip under the pointer or the focus lights its cluster. */
    function onChip(event: Event) {
      // Leaving focus, what matters is where it went, not the chip it left.
      const target = event.type === 'focusout' ? (event as FocusEvent).relatedTarget : event.target;
      const chip = (target as Element | null)?.closest?.('.hero-types a');
      const kind = chip ? new URL((chip as HTMLAnchorElement).href).searchParams.get('type') : null;
      const next = kind ? KINDS.indexOf(kind) : -1;
      if (next === lit) return;
      lit = next;
      if (!frame) draw(0);
    }

    resize();
    const sized = new ResizeObserver(() => {
      resize();
      if (!frame) draw(0);
    });
    sized.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    seen.observe(el);
    reduce.addEventListener('change', sync);
    addEventListener('pointermove', onPointer, { passive: true });
    hero.addEventListener('pointerover', onChip);
    hero.addEventListener('pointerleave', onChip);
    hero.addEventListener('focusin', onChip);
    hero.addEventListener('focusout', onChip);
    sync();

    return () => {
      cancelAnimationFrame(frame);
      sized.disconnect();
      seen.disconnect();
      reduce.removeEventListener('change', sync);
      removeEventListener('pointermove', onPointer);
      hero.removeEventListener('pointerover', onChip);
      hero.removeEventListener('pointerleave', onChip);
      hero.removeEventListener('focusin', onChip);
      hero.removeEventListener('focusout', onChip);
    };
  }, []);

  return (
    <>
      <div aria-hidden="true" className="universe">
        <canvas ref={canvas} />
      </div>
      {paused === null ? null : (
        <button
          aria-label={paused ? 'Play background animation' : 'Pause background animation'}
          className="motion-toggle"
          onClick={() => toggle.current(!paused)}
          type="button"
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? 'Play' : 'Pause'}
        </button>
      )}
    </>
  );
}
