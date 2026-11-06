'use client';

import Link from 'next/link';
import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { type DockCounts, type DockKind, isSoftwareRenderer } from '@/components/dockBoard';
import { TYPE_FILTER_LABELS } from '@/components/typeFilters';

const DockScene = lazy(() => import('@/components/DockScene'));

type Scene = 'still' | 'loading' | 'live' | 'failed';

const PAUSE_KEY = 'agentdock:motion-paused';
/** 'on' or 'off': the reader's own answer, which outranks every guess below. */
const SCENE_KEY = 'agentdock:scene';

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage refused: the controls still work, for this visit.
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // As above.
  }
}

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

/**
 * Before any of the scene is downloaded. A machine with no GPU drew it at 2.3-5.6 fps on
 * two cores and 14-16 on twenty, and paid 260 KB for that (Phase 91).
 *
 * The renderer's name is the only signal there is, and only Chromium gives it:
 * `failIfMajorPerformanceCaveat` still hands SwiftShader a context, and Firefox and WebKit
 * report a fixed name whatever is underneath (measured 2026-11-06,
 * docs/analysis/phase94-artifacts/gpu-signal-probe.txt). The name is tested and dropped,
 * never kept or sent. Where it says nothing the scene loads, and it is DockScene's own
 * frame times that end it (onTooSlow).
 */
function renderer() {
  const context = document.createElement('canvas').getContext('webgl2');
  if (!context) return 'none';
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const name = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  context.getExtension('WEBGL_lose_context')?.loseContext();
  return isSoftwareRenderer(name) ? 'software' : 'gpu';
}

/** The type a chip links to, or null for anything else, "All" included. */
function chipKind(target: EventTarget | null) {
  const chip = (target as Element | null)?.closest?.<HTMLAnchorElement>('.hero-types a');
  return chip ? (new URL(chip.href).searchParams.get('type') as DockKind | null) : null;
}

/**
 * Decides whether the 3D board loads at all, and holds what the reader has picked.
 * The still drawing is `children`, already on the page; the scene is laid over it
 * only on a wide screen, with motion allowed, a GPU behind WebGL and no data-saving
 * request. Anything else stops at the drawing and downloads nothing. `data-scene`
 * says which (e2e/journeys). Where it is the machine or a preference that stopped it
 * and not the screen or WebGL itself, the reader can ask for the scene anyway, and the
 * answer holds on the next visit. They can leave it the same way.
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
  // Whether the scene could run here at all: the button that asks for it.
  const [possible, setPossible] = useState(false);
  // Asked for by the reader: what it costs is theirs to judge, so nothing takes it back.
  const asked = useRef(false);
  const tooSlow = useRef(false);
  // A ref as well as storage, so a choice holds for this visit where storage is refused.
  const choice = useRef<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
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
    if (stored(PAUSE_KEY)) setPaused(true);
    choice.current = stored(SCENE_KEY);
    const wide = matchMedia('(min-width: 64rem)');
    const calm = matchMedia('(prefers-reduced-motion: no-preference)');
    const decide = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection;
      const kind = wide.matches ? renderer() : 'none';
      asked.current = choice.current === 'on';
      // Asked for under reduced motion: there, but holding still until told otherwise.
      if (asked.current && !calm.matches) setPaused(true);
      const start =
        kind !== 'none' &&
        (asked.current ||
          (choice.current !== 'off' &&
            calm.matches &&
            !connection?.saveData &&
            kind === 'gpu' &&
            !tooSlow.current));
      setPossible(kind !== 'none');
      setScene((now) => {
        if (now === 'failed') return now;
        if (!start) return 'still';
        return now === 'live' ? now : 'loading';
      });
    };
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
    store(PAUSE_KEY, next ? '1' : null);
  };

  const toggleScene = () => {
    asked.current = !running;
    choice.current = running ? 'off' : 'on';
    store(SCENE_KEY, choice.current);
    if (asked.current && matchMedia('(prefers-reduced-motion: reduce)').matches) setPaused(true);
    setScene(running ? 'still' : 'loading');
  };

  /** A machine the renderer's name said nothing about, and its frame times did. */
  const onTooSlow = () => {
    if (asked.current) return;
    tooSlow.current = true;
    setScene('still');
  };

  /** The button goes with the scene: if the focus is on it, it needs somewhere to land. */
  const onFailed = () => {
    if (document.activeElement === toggle.current) {
      anchor.current?.closest('.hero')?.querySelector('a')?.focus();
    }
    setScene('failed');
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
          <SceneBoundary onError={onFailed}>
            <Suspense fallback={null}>
              <DockScene
                counts={counts}
                flown={flown}
                lit={lit}
                onHover={setObjectHover}
                onLost={onFailed}
                onReady={() => setScene('live')}
                onSelect={setPicked}
                onTooSlow={onTooSlow}
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

      {scene === 'failed' && asked.current ? (
        <div className="dock-controls">
          <p role="status">The 3D view could not start. This is the drawing instead.</p>
        </div>
      ) : null}

      {possible && scene !== 'failed' ? (
        <div className="dock-controls">
          {scene === 'live' ? (
            <>
              <p>Select a dock, or tab to a type.</p>
              <button aria-pressed={paused} onClick={togglePause} type="button">
                Pause motion
              </button>
            </>
          ) : null}
          {/* One button through all three states, last in the row: it keeps the focus. */}
          <button onClick={toggleScene} ref={toggle} type="button">
            {scene === 'still' ? 'View in 3D' : 'Show the drawing'}
          </button>
        </div>
      ) : null}
    </>
  );
}
