import { describe, expect, it } from 'vitest';
import { drainStop, syncBudget } from './budget';
import { CORPUS_CAPS } from './caps';

describe('syncBudget', () => {
  it('without a token is exactly the caps the sync always ran with', () => {
    expect(syncBudget(undefined)).toEqual({
      authenticated: false,
      enqueue: 25,
      refresh: 25,
      drain: 25,
      searchRequests: 60,
      searchSpacingMs: 6_500,
    });
  });

  it('with a token drains what it queues, within 8% of the 5,000 core budget', () => {
    const b = syncBudget('ghp-not-real');
    expect(b.authenticated).toBe(true);
    expect(b.drain).toBe(b.enqueue + b.refresh);
    expect(b.drain * 2).toBeLessThanOrEqual(5_000 * 0.08);
    // 30 a minute authenticated; the spacing stays under it.
    expect(60_000 / b.searchSpacingMs).toBeLessThan(30);
    // The same wall clock as the unauthenticated sweep, not more.
    expect(b.searchRequests * b.searchSpacingMs).toBeLessThanOrEqual(
      CORPUS_CAPS.maxSearchRequests * CORPUS_CAPS.searchRequestSpacingMs,
    );
  });
});

describe('drainStop', () => {
  // pauseUntilFor clamps against the real clock, so the test uses it too.
  const now = Date.now();
  const reset = Math.floor(now / 1000) + 600;

  it('keeps going with budget and time left', () => {
    expect(drainStop({ limit: 5000, remaining: 4000, reset }, 60_000, now)).toBeNull();
    expect(drainStop(null, 0, now)).toBeNull();
  });

  it('stops on the core budget the same way pauseUntilFor always has', () => {
    expect(drainStop({ limit: 60, remaining: 1, reset }, 0, now)).toBe('core_budget');
  });

  it('stops at the deadline even with budget left', () => {
    expect(
      drainStop({ limit: 5000, remaining: 4000, reset }, CORPUS_CAPS.drainDeadlineMs, now),
    ).toBe('deadline');
  });

  it('the deadline leaves the worst single repository inside the Actions timeout', () => {
    // sync.yml timeout-minutes: 60; one scan can take 120 s plus two 10 s API timeouts.
    expect(CORPUS_CAPS.drainDeadlineMs + 140_000).toBeLessThan(60 * 60_000);
  });
});
