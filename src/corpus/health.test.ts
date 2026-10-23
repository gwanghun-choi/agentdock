import { describe, expect, it } from 'vitest';
import { formatMarkdown, formatText, outcomeCategory, type SyncReport, syncHealth } from './health';

const now = new Date('2026-10-22T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const report = (over: Partial<SyncReport> = {}): SyncReport => ({
  generatedAt: now,
  windowHours: 24,
  lastAttempt: null,
  lastSuccessAt: null,
  queue: { queued: 4, due: 1, running: 0, runningAbandoned: 0, succeeded: 10, failed: 2 },
  attempts: {
    total: 5,
    byOutcome: { ok: 2, unchanged: 1, unreadable: 1, rate_limited: 1 },
    p50Ms: 1500,
    p95Ms: 9000,
    truncated: 1,
    artifactsNew: 3,
    artifactsUpdated: 1,
    artifactsUnchanged: 7,
    artifactsRemoved: 0,
  },
  artifacts: {
    held: 12,
    listed: 10,
    byType: { skill: 9, hook: 1 },
    addedInWindow: 3,
    changedInWindow: 1,
  },
  ...over,
});

const attempt = (over: Record<string, unknown> = {}) => ({
  startedAt: hoursAgo(2).toISOString(),
  ok: true,
  failedStages: [],
  status: 'COMPLETED',
  ...over,
});

describe('syncHealth', () => {
  it('UNKNOWN when no run has ever been recorded', () => {
    expect(syncHealth({ lastAttempt: null, lastSuccessAt: null }, now).state).toBe('UNKNOWN');
  });

  it('OK for a recent COMPLETED run', () => {
    expect(syncHealth({ lastAttempt: attempt(), lastSuccessAt: hoursAgo(2) }, now)).toEqual({
      state: 'OK',
      reasons: [],
    });
  });

  it('PARTIAL when the last run stopped at a limit — not a failure', () => {
    const h = syncHealth(
      { lastAttempt: attempt({ status: 'PARTIAL_DEADLINE' }), lastSuccessAt: hoursAgo(2) },
      now,
    );
    expect(h).toEqual({ state: 'PARTIAL', reasons: ['the last run ended PARTIAL_DEADLINE'] });
  });

  it('DEGRADED when the last run failed, naming the stages', () => {
    const h = syncHealth(
      {
        lastAttempt: attempt({ ok: false, status: 'FAILED', failedStages: ['registry'] }),
        lastSuccessAt: hoursAgo(14),
      },
      now,
    );
    expect(h.state).toBe('DEGRADED');
    expect(h.reasons).toContain('the last run failed (stages: registry)');
  });

  it('DEGRADED when runs stopped happening, even if the last one was clean', () => {
    const h = syncHealth(
      {
        lastAttempt: attempt({ startedAt: hoursAgo(50).toISOString() }),
        lastSuccessAt: hoursAgo(50),
      },
      now,
    );
    expect(h.state).toBe('DEGRADED');
    expect(h.reasons).toEqual([
      'no run recorded in the last 36 h',
      'no run without errors in the last 36 h',
    ]);
  });

  it('the threshold is a parameter, and age alone is never worse than DEGRADED', () => {
    const input = {
      lastAttempt: attempt({ startedAt: hoursAgo(50).toISOString() }),
      lastSuccessAt: hoursAgo(50),
    };
    expect(syncHealth(input, now, 72).state).toBe('OK');
    expect(syncHealth(input, now, 1).state).toBe('DEGRADED');
  });

  it('a deployment from before sync:last_attempt is judged by last_success alone', () => {
    expect(syncHealth({ lastAttempt: null, lastSuccessAt: hoursAgo(3) }, now).state).toBe('OK');
  });
});

describe('outcomeCategory', () => {
  it("uses retry.ts's dispositions, with unchanged as a success", () => {
    expect(outcomeCategory('ok')).toBe('succeeded');
    expect(outcomeCategory('unchanged')).toBe('succeeded');
    expect(outcomeCategory('below_star_floor')).toBe('succeeded');
    expect(outcomeCategory('unreadable')).toBe('terminal');
    expect(outcomeCategory('unavailable')).toBe('retryable');
    expect(outcomeCategory('rate_limited')).toBe('rate_limited');
  });

  it('reports an outcome string it does not know rather than guessing', () => {
    expect(outcomeCategory('from_a_future_version')).toBe('unknown');
  });
});

describe('the rendered report', () => {
  it('names the window and the denominator of every percentage', () => {
    const text = formatText(report());
    expect(text).toContain('Attempts finished in the last 24 h (any run)');
    expect(text).toContain('failed, not retried');
    expect(text).toMatch(/failed, not retried\s+1 \(20\.0%\)/);
    expect(text).toContain('p50 1.5s, p95 9.0s');
    expect(text).toContain('10 of 12 held');
  });

  it('separates the queue now from what one run did', () => {
    const text = formatText(report({ lastAttempt: attempt({ queued: 7, due: 0 }) }));
    expect(text).toContain('Queue now (every ingest_job row, by current status)');
    expect(text).toMatch(/Queued after the drain\s+7 \(0 due\)/);
    expect(text).toMatch(/Queued\s+4 \(1 due now\)/);
  });

  it('Markdown: a stored value cannot break the table or open markup', () => {
    const md = formatMarkdown(
      report({
        lastAttempt: attempt({ ok: false, status: 'FAILED', failedStages: ['a|b<script>'] }),
        lastSuccessAt: hoursAgo(1),
      }),
    );
    expect(md).toContain('a\\|b\\<script\\>');
    expect(md).not.toContain('<script>');
    // Indentation survives as a marker, since a table cell drops leading spaces.
    expect(md).toContain('| Repositories processed |');
    expect(md).toContain('| · ingested (new or changed) |');
  });

  it('carries no connection detail — only what the report object holds', () => {
    const md = formatMarkdown(report());
    expect(md).not.toMatch(/postgres(ql)?:\/\//);
  });
});
