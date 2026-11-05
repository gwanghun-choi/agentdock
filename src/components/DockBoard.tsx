'use client';

import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import type { DockCounts } from '@/components/dockBoard';

const DockScene = lazy(() => import('@/components/DockScene'));

type Scene = 'still' | 'loading' | 'live' | 'failed';

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

/**
 * Decides whether the 3D board loads at all. The still drawing is `children`,
 * already on the page; the scene is laid over it only on a wide screen, with
 * motion allowed, WebGL present and no data-saving request. Anything else stops
 * at the drawing and downloads nothing. `data-scene` says which (e2e/journeys).
 *
 * Why React Three Fiber, against the Canvas 2D this replaces. Phase 74 rejected
 * it on 2026-10-28 for what it adds to a page: +232.5 KB gzipped on 182 KB. Here
 * it is not on the page. It is a separate chunk that starts after
 * the first paint and only on the screens above, so the phone's bytes went down.
 * Measured sizes are in docs/analysis/agentdock-phase79-dock-board.md.
 */
export function DockBoard({ counts, children }: { counts: DockCounts; children: ReactNode }) {
  const [scene, setScene] = useState<Scene>('still');

  useEffect(() => {
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

  return (
    <div aria-hidden="true" className="dock-board" data-scene={scene}>
      {children}
      {scene === 'loading' || scene === 'live' ? (
        <SceneBoundary onError={() => setScene('failed')}>
          <Suspense fallback={null}>
            <DockScene
              counts={counts}
              onLost={() => setScene('failed')}
              onReady={() => setScene('live')}
            />
          </Suspense>
        </SceneBoundary>
      ) : null}
    </div>
  );
}
