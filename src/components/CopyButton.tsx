'use client';

import { useEffect, useState } from 'react';

/**
 * Copies one string the server already rendered beside it — a path, a URL, an
 * install location. It holds no data and fetches nothing; the value is a prop.
 *
 * Absent until it can work. The Clipboard API exists only in a secure context,
 * and the Docker deployment DEPLOY.md describes is served over plain HTTP, where
 * `navigator.clipboard` is undefined; with JavaScript off there is no handler at
 * all. Both cases render no button rather than one that does nothing, and the
 * value stays selectable text either way. Revealing it after hydration moves
 * nothing: it is the last inline item on its line.
 *
 * The outcome is announced through a live region, so a screen reader hears
 * "Copied" without focus moving — and a refusal (a denied permission, a browser
 * that throws) says so instead of looking like success.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && navigator.clipboard !== undefined);
  }, []);

  useEffect(() => {
    if (status === 'idle') return;
    const timer = setTimeout(() => setStatus('idle'), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  if (!supported) return null;
  return (
    <span className="copy">
      <button
        className="copy-button"
        onClick={() =>
          copyText(value, navigator.clipboard).then(setStatus, () => setStatus('failed'))
        }
        type="button"
      >
        {label}
      </button>
      <span className="copy-status" role="status">
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Copy failed — select the text'
            : ''}
      </span>
    </span>
  );
}

export async function copyText(
  value: string,
  clipboard: Pick<Clipboard, 'writeText'>,
): Promise<'copied' | 'failed'> {
  try {
    await clipboard.writeText(value);
    return 'copied';
  } catch {
    return 'failed';
  }
}
