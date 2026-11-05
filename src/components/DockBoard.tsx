'use client';

import Link from 'next/link';
import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import type { DockCounts, DockKind } from '@/components/dockBoard';
import { TYPE_FILTER_LABELS } from '@/components/typeFilters';

const DockScene = lazy(() => import('@/components/DockScene'));

type Scene = 'still' | 'loading' | 'live' | 'failed';

const PAUSE_KEY = 'agentdock:motion-paused';

/** A chunk that will not load or a scene that throws ends here, not at app/error.tsx. */
class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function hasWebGL() {
  const context = document.createElement('canvas').getContext('webgl2');
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return context !== null;
}

/** The type a chip links to, or null for anything else, "All" included. */
function chipKind(target: EventTarget | null) {
  const chip = (target as Element | null)?.closest?.<HTMLAnchorElement>('.hero-types a');
  return chip ? (new URL(chip.href).searchParams.get('type') as DockKind | null) : null;
}

/**
 * Decides whether the 3D board loads at all, and holds what the reader has picked.
 * The still drawing is `children`, already on the page; the scene is laid over it
 * only on a wide screen, with motion allowed, WebGL present and no data-saving
 * request. Anything else stops at the drawing and downloads nothing. `data-scene`
 * says which (e2e/journeys).
 *
 * Why React Three Fiber, against the Canvas 2D this replaced. Phase 74 rejected
 * it on 2026-10-28 for what it adds to a page: +232.5 KB gzipped on 182 KB. Here
 * it is not on the page. It is a separate chunk that starts after
 * the first paint and only on the screens above, so the phone's bytes went down.
 * Measured sizes are in docs/analysis/agentdock-phase80-82-immersive-3d.md.
 *
 * The panel and the controls are here, outside `aria-hidden`, because the scene is
 * a picture of what they do: a chip under the pointer or the focus flies to its
 * dock and opens the panel, in the drawing as well as in the scene, and the chip's
 * own link is the keyboard's way to everything a click in the scene reaches.
 */
export function DockBoard({
  counts,
  blurbs,
  children,
}: {
  counts: DockCounts;
  blurbs: Partial<Record<DockKind, string>>;
  children: ReactNode;
}) {
  const [scene, setScene] = useState<Scene>('still');
  const [paused, setPaused] = useState(false);
  const [picked, setPicked] = useState<DockKind | null>(null);
  const [chipHover, setChipHover] = useState<DockKind | null>(null);
  const [chipFocus, setChipFocus] = useState<DockKind | null>(null);
  const [objectHover, setObjectHover] = useState<DockKind | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  // Focus handed back to a chip must not reopen what was just closed.
  const handingBack = useRef(false);
  const handBack = (kind: string | null | undefined) => {
    handingBack.current = true;
    anchor.current
      ?.closest('.hero')
      ?.querySelector<HTMLAnchorElement>(`.hero-types a[href$="type=${kind}"]`)
      ?.focus();
    handingBack.current = false;
  };

  const running = scene === 'loading' || scene === 'live';
  const flown = picked ?? chipFocus ?? chipHover;
  // A dock under the pointer lights, and says its name and count in the scene. The
  // panel waits for a pick: opened by a hover, it could land on the pointer, take
  // the hover away from the dock, close, and open again, many times a second.
  const lit = flown ?? objectHover;

  useEffect(() => {
    try {
      if (localStorage.getItem(PAUSE_KEY)) setPaused(true);
    } catch {
      // Storage refused: the button still works, for this visit.
    }
    const wide = matchMedia('(min-width: 64rem)');
    const calm = matchMedia('(prefers-reduced-motion: no-preference)');
    const decide = () =>
      setScene((now) => {
        if (now === 'failed') return now;
        const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
          .connection;
        if (!wide.matches || !calm.matches || connection?.saveData || !hasWebGL()) return 'still';
        return now === 'live' ? now : 'loading';
      });
    // After the page's own work: the scene never competes with the search box.
    const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    const pending = idle(decide);
    wide.addEventListener('change', decide);
    calm.addEventListener('change', decide);
    return () => {
      cancel(pending);
      wide.removeEventListener('change', decide);
      calm.removeEventListener('change', decide);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: handBack reads only refs.
  useEffect(() => {
    const hero = anchor.current?.closest('.hero');
    if (!hero) return;
    const onOver = (event: Event) => setChipHover(chipKind(event.target));
    const onLeave = () => setChipHover(null);
    const onFocusIn = (event: Event) => {
      // Tabbing from the last chip into the panel keeps the panel it is going into.
      if (handingBack.current || (event.target as Element).closest('.dock-panel')) return;
      setChipFocus(chipKind(event.target));
    };
    const onFocusOut = (event: Event) => {
      if (!hero.contains((event as FocusEvent).relatedTarget as Node | null)) setChipFocus(null);
    };
    const onKey = (event: Event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      // From inside the panel, or the focus goes with it.
      const panel = document.activeElement?.closest<HTMLElement>('.dock-panel');
      if (panel) handBack(panel.dataset.kind);
      setPicked(null);
      setChipFocus(null);
    };
    hero.addEventListener('pointerover', onOver);
    hero.addEventListener('pointerleave', onLeave);
    hero.addEventListener('focusin', onFocusIn);
    hero.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey);
    return () => {
      hero.removeEventListener('pointerover', onOver);
      hero.removeEventListener('pointerleave', onLeave);
      hero.removeEventListener('focusin', onFocusIn);
      hero.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    try {
      if (next) localStorage.setItem(PAUSE_KEY, '1');
      else localStorage.removeItem(PAUSE_KEY);
    } catch {
      // As above: it holds for this visit.
    }
  };

  /** Closing takes the focus back to the chip, or it falls out of the page with the panel. */
  const close = () => {
    handBack(picked);
    setPicked(null);
  };

  const count = flown ? (counts[flown] ?? 0) : 0;

  return (
    <>
      <div aria-hidden="true" className="dock-board" data-scene={scene} ref={anchor}>
        {children}
        {running ? (
          <SceneBoundary onError={() => setScene('failed')}>
            <Suspense fallback={null}>
              <DockScene
                counts={counts}
                flown={flown}
                lit={lit}
                onHover={setObjectHover}
                onLost={() => setScene('failed')}
                onReady={() => setScene('live')}
                onSelect={setPicked}
                paused={paused}
              />
            </Suspense>
          </SceneBoundary>
        ) : null}
      </div>

      {flown ? (
        <section
          aria-label={`${TYPE_FILTER_LABELS[flown]} in the index`}
          className={`dock-panel dock-${flown}`}
          data-kind={flown}
          key={flown}
        >
          <p className="dock-panel-kind">{TYPE_FILTER_LABELS[flown]}</p>
          <p className="dock-panel-count">
            {count > 0 ? (
              <>
                <strong>{count.toLocaleString('en-US')}</strong> listed
              </>
            ) : (
              'None listed yet'
            )}
          </p>
          <p className="dock-panel-what">{blurbs[flown]}</p>
          <div className="dock-panel-actions">
            <Link href={`/artifacts?type=${flown}`}>Browse {TYPE_FILTER_LABELS[flown]}</Link>
            {picked ? (
              <button onClick={close} type="button">
                Close
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {scene === 'live' ? (
        <div className="dock-controls">
          <p>Select a dock, or tab to a type.</p>
          <button aria-pressed={paused} onClick={togglePause} type="button">
            Pause motion
          </button>
        </div>
      ) : null}
    </>
  );
}
