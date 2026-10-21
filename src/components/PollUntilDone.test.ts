import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, startPolling } from './PollUntilDone';

/** A stand-in for `document`: only the three members startPolling reads. */
function fakeDocument(initial: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  const doc = {
    visibilityState: initial,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
  return doc;
}

describe('startPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks once a minute while queued, not every 1.5 s', () => {
    const refresh = vi.fn();
    startPolling('queued', refresh, fakeDocument() as unknown as Document);
    vi.advanceTimersByTime(59_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Twelve hours queued (one sync interval) is 720 refreshes, not 28,800.
    vi.advanceTimersByTime(12 * 60 * 60 * 1000 - 60_000);
    expect(refresh).toHaveBeenCalledTimes(720);
  });

  it('asks every 2 s while running', () => {
    const refresh = vi.fn();
    startPolling('running', refresh, fakeDocument() as unknown as Document);
    vi.advanceTimersByTime(10_000);
    expect(POLL_MS.running).toBe(2_000);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it.each(['succeeded', 'failed'])('never asks once %s', (status) => {
    const refresh = vi.fn();
    startPolling(status, refresh, fakeDocument() as unknown as Document);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops while hidden and refreshes once on coming back', () => {
    const refresh = vi.fn();
    const doc = fakeDocument();
    startPolling('running', refresh, doc as unknown as Document);
    doc.set('hidden');
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
    doc.set('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not start at all in a tab opened in the background', () => {
    const refresh = vi.fn();
    startPolling('running', refresh, fakeDocument('hidden') as unknown as Document);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('leaves no timer and no listener behind after cleanup, so a status change cannot double the rate', () => {
    const refresh = vi.fn();
    const doc = fakeDocument();
    const stop = startPolling('queued', refresh, doc as unknown as Document);
    stop();
    // The effect re-runs with the new status; only the new interval may fire.
    startPolling('running', refresh, doc as unknown as Document);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(30);
    doc.set('hidden');
    doc.set('visible');
    expect(refresh).toHaveBeenCalledTimes(31);
  });
});
