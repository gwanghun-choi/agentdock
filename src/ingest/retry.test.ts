import { describe, expect, it } from 'vitest';
import { type IngestOutcome, OUTCOME_MESSAGES } from './errors';
import {
  backoffMs,
  type Disposition,
  dispositionFor,
  MAX_ATTEMPTS,
  pauseUntilFor,
  RATE_CLAMP_MS,
  rateLimitedUntil,
} from './retry';

/**
 * The whole policy, proved with no clock and no database — so this suite stays
 * visible in CI rather than skipping there.
 */

// Driven from the message table rather than from a hand-written list, so the
// suite cannot fall behind the type: every non-success outcome must have a
// message (the outcome suite asserts that), so a tenth outcome appears here the
// moment it exists and its disposition is demanded below.
const OUTCOMES = ['ok', ...Object.keys(OUTCOME_MESSAGES)] as IngestOutcome[];

const MINUTE = 60_000;

describe('the delay curve', () => {
  it('is one minute, then two, then four', () => {
    expect(backoffMs(1)).toBe(1 * MINUTE);
    expect(backoffMs(2)).toBe(2 * MINUTE);
    expect(backoffMs(3)).toBe(4 * MINUTE);
  });

  it('never exceeds fifteen minutes however many attempts have been made', () => {
    for (const attempts of [5, 8, 20, 1000]) {
      expect(backoffMs(attempts)).toBe(15 * MINUTE);
    }
  });

  it('never decreases as attempts rise', () => {
    const delays = Array.from({ length: 20 }, (_, i) => backoffMs(i + 1));
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  });
});

describe('the disposition table', () => {
  it('classifies every outcome the union holds', () => {
    expect(OUTCOMES).toHaveLength(9);
    for (const outcome of OUTCOMES) {
      expect(dispositionFor(outcome)).toBeDefined();
    }
  });

  it.each(['unreadable', 'too_large', 'invalid_input'] as const)(
    'treats %s as terminal on the first attempt',
    (outcome) => {
      expect(dispositionFor(outcome)).toBe('terminal');
    },
  );

  it.each(['denylisted', 'no_artifacts', 'ok'] as const)('treats %s as a success', (outcome) => {
    // The job did its work and the answer is "no". A failure here would put it
    // in the retry path, where every attempt produces the same answer.
    expect(dispositionFor(outcome)).toBe('succeeded');
  });

  it('retries only an unreachable GitHub and a storage failure', () => {
    const retryable = OUTCOMES.filter((o) => dispositionFor(o) === 'retryable');
    expect(retryable.sort()).toEqual(['storage_failed', 'unavailable']);
  });

  it('gives an exhausted budget its own disposition, outside the retryable set', () => {
    const disposition: Disposition = dispositionFor('rate_limited');
    expect(disposition).toBe('rate_limited');
    expect(disposition).not.toBe('retryable');
  });

  it('caps a repository at three attempts', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});

describe('the rate-limit schedule', () => {
  const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

  it('clamps a reset an hour and a half away to an hour from the reference time', () => {
    const reset = (NOW + 90 * MINUTE) / 1000;
    expect(rateLimitedUntil(reset, NOW).getTime()).toBe(NOW + RATE_CLAMP_MS);
  });

  it('clamps a hostile value a year out to the same ceiling', () => {
    const reset = (NOW + 365 * 24 * 60 * MINUTE) / 1000;
    // The ceiling is the security control: the reset is a response header, so a
    // malformed or hostile value must not park a job in the next century.
    expect(rateLimitedUntil(reset, NOW).getTime()).toBe(NOW + RATE_CLAMP_MS);
  });

  it('schedules a reset already in the past at the reference time, never before it', () => {
    // The floor is the correctness control: a stale value must not schedule a
    // job into the past, where it would be claimed immediately and fail again.
    expect(rateLimitedUntil((NOW - 10 * MINUTE) / 1000, NOW).getTime()).toBe(NOW);
  });

  it('keeps a reset inside the window exactly as GitHub reported it', () => {
    const reset = Math.floor((NOW + 12 * MINUTE) / 1000);
    expect(rateLimitedUntil(reset, NOW).getTime()).toBe(reset * 1000);
  });

  it.each([
    ['missing', null],
    ['undefined', undefined],
    ['zero', 0],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('takes the ceiling for a %s reset', (_label, reset) => {
    // Knowing nothing about when the budget returns is not a reason to guess
    // early.
    expect(rateLimitedUntil(reset, NOW).getTime()).toBe(NOW + RATE_CLAMP_MS);
  });

  it('reads the clock only when no reference time is given', () => {
    const before = Date.now();
    const at = rateLimitedUntil(null).getTime();
    expect(at).toBeGreaterThanOrEqual(before + RATE_CLAMP_MS);
    expect(at).toBeLessThanOrEqual(Date.now() + RATE_CLAMP_MS);
  });
});

describe('the preemptive gate', () => {
  const reset = Math.floor((Date.now() + 10 * MINUTE) / 1000);

  it.each([0, 1])('defers when only %i requests remain', (remaining) => {
    // An ingest costs two core requests, so one left means the next claim would
    // spend one only to discover the wall.
    expect(pauseUntilFor({ limit: 60, remaining, reset }, 0)).toBe(reset * 1000);
  });

  it('leaves the loop alone while there is budget for a whole ingest', () => {
    expect(pauseUntilFor({ limit: 60, remaining: 2, reset }, 0)).toBe(0);
    expect(pauseUntilFor({ limit: 60, remaining: 55, reset }, 0)).toBe(0);
    // Nothing recorded yet is not a reason to stop.
    expect(pauseUntilFor(null, 0)).toBe(0);
  });

  it('resumes once the recorded reset has passed, with no restart', () => {
    const stale = Math.floor((Date.now() - 10 * MINUTE) / 1000);

    // Clamped up to the reference time, so the loop's own `now < pausedUntil`
    // check is already false on its next pass — no restart involved.
    expect(pauseUntilFor({ limit: 60, remaining: 0, reset: stale }, 0)).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it('keeps an existing pause when nothing has been recorded since', () => {
    const parked = Date.now() + 5 * MINUTE;
    expect(pauseUntilFor(null, parked)).toBe(parked);
  });
});
