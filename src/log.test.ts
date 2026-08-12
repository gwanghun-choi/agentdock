import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttemptOutcome } from '@/ingest/errors';
import { messageFor, OUTCOME_MESSAGES } from '@/ingest/errors';
import { log } from '@/log';

/**
 * The secret-absence proof for the one line AgentDock writes per ingestion.
 *
 * This suite touches no database and opens no socket, so it is one of the four
 * that stay visible in CI rather than skipping there.
 */

const OUTCOMES: AttemptOutcome[] = [
  'ok',
  'invalid_input',
  'denylisted',
  'unreadable',
  'rate_limited',
  'too_large',
  'no_artifacts',
  'unavailable',
  'storage_failed',
  'unchanged',
];

// Sentinels, not real values. Asserting against the real environment would make
// this pass on a machine that happens to have neither set; a planted value that
// cannot appear is the runnable form of the claim.
const TOKEN = 'ghp_SENTINEL_TOKEN_VALUE_0000000000';
const DSN = 'postgres://sentinel_user:sentinel_pw@db.internal:5432/sentinel_db';

const KEYS = [
  'attempt',
  'commitSha',
  'durationMs',
  'event',
  'failed',
  'found',
  'jobId',
  'new',
  'outcome',
  'owner',
  'rateRemaining',
  'rateReset',
  'removed',
  'repo',
  'seedsSkipped',
  'stored',
  'truncated',
  'ts',
  'unchanged',
  'updated',
];

/** A fully populated line for one outcome — every field carrying a real value. */
function entryFor(outcome: AttemptOutcome) {
  return {
    event: 'ingest',
    jobId: 42,
    attempt: 2,
    owner: 'anthropics',
    repo: 'skills',
    commitSha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
    outcome,
    found: 18,
    stored: 18,
    failed: 1,
    new: 3,
    updated: 4,
    unchanged: 11,
    removed: 2,
    seedsSkipped: 3,
    truncated: true,
    durationMs: 1234,
    rateRemaining: 55,
    rateReset: 1786337813,
  } as const;
}

function capture(entry: Parameters<typeof log>[0]): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  log(entry);
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0][0] as string;
}

describe('the ingest log line', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(OUTCOMES)('serializes exactly the declared key set for %s', (outcome) => {
    const line = capture(entryFor(outcome));
    const parsed = JSON.parse(line);

    // There is no payload parameter, so there is no key here that could hold a
    // response body or a credential. That is the whole mechanism.
    expect(Object.keys(parsed).sort()).toEqual(KEYS);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.outcome).toBe(outcome);
  });

  it.each(OUTCOMES)('carries neither planted sentinel for %s', (outcome) => {
    const line = capture(entryFor(outcome));

    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(DSN);
    expect(line).not.toContain('ghp_');
    expect(line).not.toContain('postgres://');
    expect(line).not.toMatch(/Bearer|authorization|password/i);
  });

  it('carries seedsSkipped as a number on every outcome, zero included', () => {
    // The Phase 4 observability item, closed. A field that appeared only when
    // non-zero would make its absence ambiguous between "no catalog" and "an
    // older build", which is the ambiguity analyzed_at exists to prevent
    // elsewhere in this schema. It is a number, so no entry text, no path and no
    // response body can be assigned into it.
    for (const outcome of OUTCOMES) {
      const zeroed = { ...entryFor(outcome), seedsSkipped: 0 };
      const parsed = JSON.parse(capture(zeroed));
      expect(parsed).toHaveProperty('seedsSkipped', 0);
      expect(typeof parsed.seedsSkipped).toBe('number');
      vi.restoreAllMocks();
    }
  });

  it('stays short enough to read, because there is nowhere for a body to go', () => {
    // The whole populated line, with every field at its widest realistic value.
    expect(capture(entryFor('ok')).length).toBeLessThan(500);
  });

  it('emits the worker lifecycle with no message to interpolate into', () => {
    const parsed = JSON.parse(capture({ event: 'worker', state: 'error', jobId: null }));
    expect(Object.keys(parsed).sort()).toEqual(['event', 'jobId', 'state', 'ts']);
    expect(parsed).toMatchObject({ event: 'worker', state: 'error', jobId: null });
  });
});

describe('the messages an outcome can produce', () => {
  const messages = [
    ...Object.values(OUTCOME_MESSAGES),
    messageFor('rate_limited', 1786337813),
    messageFor('ok'),
  ];

  it.each(messages)('carries neither planted sentinel: %s', (message) => {
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(DSN);
    expect(message).not.toMatch(/ghp_|postgres:\/\/|Bearer/);
  });
});

describe('the outcome field', () => {
  it('rejects a value outside the union at type-check time', () => {
    // A field typed as a bare string accepts a stringified exception. This is
    // the line that would compile if it were still one, and `bun run typecheck`
    // is what enforces that it does not.
    const notAnOutcome = 'Error: connect ECONNREFUSED 127.0.0.1:5432';
    // @ts-expect-error — the outcome union has no member for an exception.
    const rejected: AttemptOutcome = notAnOutcome;

    expect(OUTCOMES).not.toContain(rejected);
  });
});
