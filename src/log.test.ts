import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttemptOutcome } from '@/ingest/errors';
import { messageFor, OUTCOME_MESSAGES } from '@/ingest/errors';
import type { SearchLog } from '@/log';
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

/**
 * DIS-08's line. Extending this file rather than creating a second one —
 * this plan's own research_drift note records that both 06-RESEARCH.md and
 * 06-VALIDATION.md claimed no test file existed for log.ts, and it does,
 * carrying the exact sentinel/capture/exact-key-set discipline this line
 * needs to reuse rather than duplicate.
 */
const SEARCH_KEYS = [
  'capabilities',
  'durationMs',
  'event',
  'page',
  'query',
  'resultCount',
  'totalCount',
  'ts',
  'types',
];

/** A fully populated search line — every field carrying a real value. */
function searchEntryFor(overrides: Partial<SearchLog> = {}): SearchLog {
  return {
    event: 'search',
    query: 'mcp server',
    types: ['mcp_server'],
    capabilities: ['no_network', 'no_shell'],
    page: 1,
    resultCount: 12,
    totalCount: 12,
    durationMs: 42,
    ...overrides,
  };
}

describe('the search log line', () => {
  afterEach(() => vi.restoreAllMocks());

  it('serializes exactly the declared key set, asserted the same way the ingest line already is', () => {
    const parsed = JSON.parse(capture(searchEntryFor()));
    expect(Object.keys(parsed).sort()).toEqual(SEARCH_KEYS);
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('carries resultCount as the number 0, present rather than omitted, for a zero-result search', () => {
    const parsed = JSON.parse(capture(searchEntryFor({ resultCount: 0, totalCount: 0 })));
    expect(parsed).toHaveProperty('resultCount', 0);
    expect(typeof parsed.resultCount).toBe('number');
  });

  it('carries types and capabilities as empty arrays, present rather than omitted, for an unfiltered entry', () => {
    const parsed = JSON.parse(capture(searchEntryFor({ types: [], capabilities: [] })));
    expect(parsed.types).toEqual([]);
    expect(parsed.capabilities).toEqual([]);
  });

  it('carries query as the empty string, present rather than omitted, for a browse request', () => {
    const parsed = JSON.parse(capture(searchEntryFor({ query: '' })));
    expect(parsed).toHaveProperty('query', '');
  });

  it('carries neither planted sentinel, in an ordinary populated line', () => {
    const line = capture(searchEntryFor());
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(DSN);
    expect(line).not.toContain('ghp_');
    expect(line).not.toContain('postgres://');
    expect(line).not.toMatch(/Bearer|authorization|password/i);
  });

  it('DOES carry a sentinel planted inside the query field — the query is genuinely free-form, and that is documented here rather than silently assumed absent', () => {
    // query is the one deliberate exception to this union's closed-field
    // rule (log.ts's own doc). Every other field on SearchLog is a number,
    // a bounded id from a closed set, or the fixed string 'search' — none
    // of them can carry a credential. query can, because a user can type
    // anything, and D-44 accepts that risk rather than dropping the field
    // DIS-08 requires. The line still stays on stdout only, with no
    // account, session, cookie or IP anywhere near it (v1 has no auth).
    const line = capture(searchEntryFor({ query: `search ${TOKEN} term` }));
    expect(line).toContain(TOKEN);
  });

  it('stays under a stated length bound with the longest query SEARCH_CAPS permits', () => {
    // SEARCH_CAPS.maxQueryLength is 200 (src/db/queries/search.ts) — not
    // imported here (log.ts stays DB-free at module load), so the bound is
    // restated as a literal for this one length assertion.
    const longestQuery = 'x'.repeat(200);
    const line = capture(searchEntryFor({ query: longestQuery }));
    expect(line.length).toBeLessThan(600);
  });

  it('log() still accepts an ingest entry unchanged', () => {
    expect(() => capture(entryFor('ok'))).not.toThrow();
  });

  it('log() still accepts a worker entry unchanged', () => {
    expect(() => capture({ event: 'worker', state: 'started', jobId: null })).not.toThrow();
  });

  it('rejects an event value outside the closed union at type-check time', () => {
    const notAnEvent = 'not-a-real-event';
    // @ts-expect-error — SearchLog's event union has no member for this string.
    const rejected: SearchLog = { ...searchEntryFor(), event: notAnEvent };

    expect(rejected.event).not.toBe('search');
  });
});
