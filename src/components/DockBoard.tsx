'use client';

import Link from 'next/link';
import { Component, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import {
  type DockCounts,
  type DockExample,
  type DockKind,
  isSoftwareRenderer,
  nextDock,
  TOUR_ORDER,
} from '@/components/dockBoard';
import { ArrowRightIcon } from '@/components/Icon';
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
 *
 * `tour` is the dock in focus when the reader has not picked one: where the scene is running
 * it moves by itself, a drag moves it, and the arrows move it everywhere, the drawing
 * included. Under 64rem the cards below the drawing are the same thing, swiped: CSS scroll
 * snap, with no script needed to reach any of it. The panel's examples are the one read this
 * component makes, after the first paint and from the CDN: /api/docks/[kind] says why.
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
  const [tour, setTour] = useState<DockKind | null>(null);
  const [touched, setTouched] = useState(0);
  // Said once, for a step the reader took: the tour's own steps are not announced.
  const [said, setSaid] = useState('');
  const [examples, setExamples] = useState<Partial<Record<DockKind, DockExample[]>>>({});
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

  // Nothing in focus, and the scene told: it waits before the tour picks a dock again, or the
  // next frame would bring back what the reader just closed. Also what wakes a stopped loop.
  const letGo = () => {
    setTour(null);
    setTouched((n) => n + 1);
  };

  const running = scene === 'loading' || scene === 'live';
  const flown = picked ?? chipFocus ?? chipHover;
  // A dock under the pointer lights, and says its name and count in the scene. The
  // panel waits for a pick: opened by a hover, it could land on the pointer, take
  // the hover away from the dock, close, and open again, many times a second.
  const lit = flown ?? objectHover;
  // The scene turning by itself: where the tour's steps come from.
  const touring = scene === 'live' && !paused;
  const shown = flown ?? tour;

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

  // The tour carries on from wherever the reader last was. Elsewhere a chip only borrows the
  // panel, as it always did: nothing would ever move it on.
  useEffect(() => {
    if (flown && touring) setTour(flown);
  }, [flown, touring]);

  // The scene gone (asked away, too slow, lost): what it had in focus goes with it, on a wide
  // screen. A narrow one's focus is the card in view.
  useEffect(() => {
    if (!running && matchMedia('(min-width: 64rem)').matches) setTour(null);
  }, [running]);

  // Under a moment's wait, so a pointer crossing the chips asks for nothing.
  useEffect(() => {
    if (!shown || examples[shown] || !matchMedia('(min-width: 64rem)').matches) return;
    const wait = setTimeout(async () => {
      const rows = await fetch(`/api/docks/${shown}`)
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []);
      setExamples((now) => ({ ...now, [shown]: rows }));
    }, 250);
    return () => clearTimeout(wait);
  }, [shown, examples]);

  // A swipe through the cards lights the drawing above them.
  useEffect(() => {
    const cards = anchor.current?.closest('.hero')?.querySelector('.dock-cards');
    if (!cards) return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setTour((entry.target as HTMLElement).dataset.kind as DockKind);
        }
      },
      { root: cards, threshold: 0.7 },
    );
    for (const card of cards.children) seen.observe(card);
    return () => seen.disconnect();
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
      const { key, altKey, ctrlKey, metaKey, shiftKey } = event as KeyboardEvent;
      const plain = !altKey && !ctrlKey && !metaKey && !shiftKey; // Alt+Left is the browser's
      // The chips as one row: focus flies the ring, so this is the ring by keyboard.
      const chip = (event.target as Element).closest?.('.hero-types a');
      if (plain && chip && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        const row = [...hero.querySelectorAll<HTMLElement>('.hero-types a')];
        const by = key === 'ArrowLeft' ? -1 : 1;
        row[(row.indexOf(chip as HTMLElement) + by + row.length) % row.length].focus();
        event.preventDefault();
        return;
      }
      if (key !== 'Escape') return;
      // From inside the panel, or the focus goes with it.
      const panel = document.activeElement?.closest<HTMLElement>('.dock-panel');
      if (panel) handBack(panel.dataset.kind);
      setPicked(null);
      setChipFocus(null);
      letGo();
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
    handBack(picked ?? tour);
    setPicked(null);
    letGo();
  };

  /** One dock along. A pick stays a pick; with nothing turning, this is what opens the panel. */
  const step = (by: 1 | -1) => {
    const next = shown ? nextDock(shown, by) : TOUR_ORDER[by === 1 ? 0 : TOUR_ORDER.length - 1];
    if (picked || !touring) setPicked(next);
    else {
      setTour(next);
      setTouched((n) => n + 1);
    }
    setSaid(`${TYPE_FILTER_LABELS[next]}, ${(counts[next] ?? 0).toLocaleString('en-US')} listed`);
  };

  const count = shown ? (counts[shown] ?? 0) : 0;

  return (
    <>
      <div
        aria-hidden="true"
        className="dock-board"
        data-focus={shown ?? undefined}
        data-scene={scene}
        ref={anchor}
      >
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
                onTour={setTour}
                paused={paused}
                touched={touched}
                tour={tour}
              />
            </Suspense>
          </SceneBoundary>
        ) : null}
      </div>

      {shown ? (
        <section
          aria-label={`${TYPE_FILTER_LABELS[shown]} in the index`}
          className={`dock-panel dock-${shown}`}
          data-kind={shown}
          key={shown}
        >
          <p className="dock-panel-kind">{TYPE_FILTER_LABELS[shown]}</p>
          <p className="dock-panel-count">
            {count > 0 ? (
              <>
                <strong>{count.toLocaleString('en-US')}</strong> listed
              </>
            ) : (
              'None listed yet'
            )}
          </p>
          <p className="dock-panel-what">{blurbs[shown]}</p>
          {count > 0 ? (
            <div className="dock-examples" data-loading={examples[shown] ? undefined : ''}>
              {examples[shown]?.length ? (
                <>
                  <p>Recently read</p>
                  <ul>
                    {examples[shown].map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} prefetch={false}>
                          {item.name}
                        </Link>
                        <span className="repo">{item.fullName}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="dock-panel-actions">
            <Link href={`/artifacts?type=${shown}`}>
              Browse {TYPE_FILTER_LABELS[shown]} <ArrowRightIcon />
            </Link>
            {count > 0 ? (
              // A plain link: a prefetch would follow the redirect and spend a read on nobody.
              <a href={`/artifacts/random?type=${shown}`} rel="nofollow">
                Open one at random
              </a>
            ) : null}
            {picked || (tour && !touring) ? (
              <button onClick={close} type="button">
                Close
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The drawing's other way in on a narrow screen: a swipe from one to the next. */}
      <ul aria-label="Artifact types" className="dock-cards">
        {TOUR_ORDER.map((id) => (
          <li className={`dock-card dock-${id}`} data-kind={id} key={id}>
            <p className="dock-card-head">
              <span>{TYPE_FILTER_LABELS[id]}</span>
              <b>{(counts[id] ?? 0).toLocaleString('en-US')}</b>
            </p>
            <p className="dock-card-what">{blurbs[id]}</p>
            <p className="dock-card-actions">
              <Link href={`/artifacts?type=${id}`} prefetch={false}>
                Browse <ArrowRightIcon />
              </Link>
              {counts[id] ? (
                <a href={`/artifacts/random?type=${id}`} rel="nofollow">
                  Open one at random
                </a>
              ) : null}
            </p>
          </li>
        ))}
      </ul>

      {scene === 'failed' && asked.current ? (
        <div className="dock-controls">
          <p role="status">The 3D view could not start. This is the drawing instead.</p>
        </div>
      ) : null}

      <div className="dock-controls">
        <p aria-live="polite" className="sr-only">
          {said}
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and a legend for two buttons. */}
        <div
          aria-label="Step through the artifact types"
          className="dock-step"
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            step(event.key === 'ArrowLeft' ? -1 : 1);
            event.preventDefault();
          }}
          role="group"
        >
          <button aria-label="Previous type" onClick={() => step(-1)} type="button">
            <ArrowRightIcon />
          </button>
          <span aria-hidden="true">
            {shown ? `${TOUR_ORDER.indexOf(shown) + 1} / ${TOUR_ORDER.length}` : 'Types'}
          </span>
          <button aria-label="Next type" onClick={() => step(1)} type="button">
            <ArrowRightIcon />
          </button>
        </div>
        {scene === 'live' ? <p className="dock-hint">Drag the ring, or pick a dock.</p> : null}
        {scene === 'live' ? (
          <button aria-pressed={paused} onClick={togglePause} type="button">
            Pause motion
          </button>
        ) : null}
        {/* One button through all three states, last in the row: it keeps the focus. */}
        {possible && scene !== 'failed' ? (
          <button onClick={toggleScene} ref={toggle} type="button">
            {scene === 'still' ? 'View in 3D' : 'Show the drawing'}
          </button>
        ) : null}
      </div>
    </>
  );
}
