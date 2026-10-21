'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * How often each status is worth asking about again, in ms. A queued job waits
 * for the next scheduled sync (sync.yml runs at 06:00 and 18:00 UTC), so asking
 * every 1.5 s — what this did before — spent up to 28,800 page renders, each
 * one a Vercel invocation and a Neon wake-up, to learn nothing for twelve
 * hours. A minute still shows the claim within one look away. Only `running`
 * changes on a human timescale. A terminal status is absent: nothing left to see.
 */
export const POLL_MS: Partial<Record<string, number>> = { queued: 60_000, running: 2_000 };

type Visibility = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * The polling policy, kept out of the component so it runs under fake timers
 * with no DOM: one interval while the page is visible, none while it is
 * hidden, and one immediate refresh on coming back, so a tab left in the
 * background shows the current state the moment it is looked at.
 */
export function startPolling(status: string, refresh: () => void, doc: Visibility): () => void {
  const every = POLL_MS[status];
  if (every === undefined) return () => {};

  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    timer = setInterval(refresh, every);
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') {
      refresh();
      start();
    } else {
      stop();
    }
  };

  if (doc.visibilityState === 'visible') start();
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    stop();
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Holds no data and renders nothing. The page is server-rendered and works with
 * JavaScript off; this only re-triggers that render while there is something
 * left to see.
 *
 * ponytail: router.refresh() rather than a JSON endpoint; add the endpoint the
 * day a non-browser client wants job status.
 */
export function PollUntilDone({ status }: { status: string }) {
  const router = useRouter();
  useEffect(() => startPolling(status, () => router.refresh(), document), [status, router]);
  return null;
}
