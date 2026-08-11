'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Holds no data and renders nothing. The page is server-rendered and works with
 * JavaScript off; this only re-triggers that render while there is something
 * left to see.
 *
 * ponytail: router.refresh() rather than a JSON endpoint; add the endpoint the
 * day a non-browser client wants job status.
 */
export function PollUntilDone({ done }: { done: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(timer);
  }, [done, router]);
  return null;
}
