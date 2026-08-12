import { describe, expect, it } from 'vitest';
import { GitHubError } from '@/github/client';
import type { GitHubFailure } from '@/github/types';
import { type IngestOutcome, messageFor, OUTCOME_MESSAGES, toIngestOutcome } from './errors';

const OUTCOMES: IngestOutcome[] = [
  'ok',
  'invalid_input',
  'denylisted',
  'unreadable',
  'rate_limited',
  'too_large',
  'no_artifacts',
  'unavailable',
  'storage_failed',
  'forked',
  'archived',
  'below_star_floor',
];

const FAILURES: GitHubFailure[] = [
  'invalid_repo',
  'unreadable',
  'rate_limited',
  'too_large',
  'unavailable',
];

const messages = Object.values(OUTCOME_MESSAGES);

describe('the outcome table', () => {
  it('gives every non-success outcome exactly one message', () => {
    const named = OUTCOMES.filter((o) => o !== 'ok');
    expect(Object.keys(OUTCOME_MESSAGES).sort()).toEqual([...named].sort());
    for (const outcome of named) {
      expect(messageFor(outcome).length).toBeGreaterThan(20);
    }
    // Twelve outcomes, eleven of which a person can be shown. The three added
    // by the discovery gate (src/corpus/policy.ts) carry messages for the same
    // reason every other one does: a job page that showed a bare status token
    // would make the policy invisible to the person it applied to.
    expect(OUTCOMES).toHaveLength(12);
    expect(new Set(messages).size).toBe(11);
  });

  it('says nothing on success, so there is no empty banner to render', () => {
    expect(messageFor('ok')).toBe('');
  });

  /**
   * The load-bearing assertion of this file. GitHub answers a missing repository
   * and a private one identically, on purpose, so "that repository does not
   * exist" is a false statement about roughly half of the repositories that
   * reach this message. The shorter sentence reads better and someone will
   * eventually write it; this is what stops them.
   *
   * Non-existence may be *mentioned*, because the honest message has to name
   * both possibilities to explain the ambiguity. What is forbidden is mentioning
   * it without the other half, which is what an "improved" message would do.
   */
  it.each(messages)('never asserts non-existence unpaired: %s', (message) => {
    if (!/does not exist|doesn't exist|not found|no such|never existed|\b404\b/i.test(message)) {
      return;
    }
    expect(message).toMatch(/private/i);
    expect(message).toMatch(/cannot tell which|indistinguishable|same response/i);
    expect(message).not.toMatch(/(that|this|the) repository (does not|doesn't) exist/i);
  });

  it('names both indistinguishable cases in the unreadable message', () => {
    expect(OUTCOME_MESSAGES.unreadable).toMatch(/private/);
    expect(OUTCOME_MESSAGES.unreadable).toMatch(/cannot tell which/);
  });

  it.each(messages)('carries no internal detail: %s', (message) => {
    expect(message).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules|\.tsx?:\d+|Error:/);
    expect(message).not.toMatch(/src\/|\/home\/|\.\/|node:|file:\/\//);
    expect(message).not.toMatch(/api\.github\.com|raw\.githubusercontent\.com|localhost|127\.0\.0/);
    expect(message).not.toMatch(/\bselect\b|\binsert\b|\bdelete\b|drop table|search_path|pg_/i);
    expect(message).not.toMatch(/DATABASE_URL|DATABASE_SCHEMA|GITHUB_TOKEN|process\.env|Bearer/);
  });

  it('states the real shape of the budget rather than telling someone to try later', () => {
    expect(OUTCOME_MESSAGES.rate_limited).toMatch(/60 requests an hour/);
    expect(OUTCOME_MESSAGES.rate_limited).toMatch(/costs two/);
  });

  it('adds the reset time when it is known', () => {
    // 1786337813 is 2026-08-10T04:56:53Z
    expect(messageFor('rate_limited', 1786337813)).toMatch(/The budget resets at 04:56 UTC\.$/);
  });

  it('stays a complete sentence when the reset time is not known', () => {
    const without = messageFor('rate_limited');
    expect(without).toBe(OUTCOME_MESSAGES.rate_limited);
    expect(without).not.toMatch(/undefined|NaN|Invalid Date|resets at\s*$/);
    expect(without.endsWith('.')).toBe(true);
  });

  it('ignores a reset time on every outcome that is not about the budget', () => {
    expect(messageFor('unavailable', 1786337813)).toBe(OUTCOME_MESSAGES.unavailable);
  });
});

describe('toIngestOutcome', () => {
  it.each(FAILURES)('maps the %s client failure onto exactly one outcome', (failure) => {
    const outcome = toIngestOutcome(new GitHubError(failure, 'internal text'));
    expect(OUTCOMES).toContain(outcome);
    expect(outcome).not.toBe('ok');
  });

  it('maps each client failure onto the outcome that describes it', () => {
    expect(FAILURES.map((f) => toIngestOutcome(new GitHubError(f, 'x')))).toEqual([
      'invalid_input',
      'unreadable',
      'rate_limited',
      'too_large',
      'unavailable',
    ]);
  });

  it('turns an unrecognised exception into the storage failure rather than surfacing it', () => {
    const secret = 'password=hunter2 at /home/x/src/db/client.ts:12:3';
    expect(toIngestOutcome(new Error(secret))).toBe('storage_failed');
    expect(toIngestOutcome('a string')).toBe('storage_failed');
    expect(toIngestOutcome(undefined)).toBe('storage_failed');
    expect(messageFor(toIngestOutcome(new Error(secret)))).not.toMatch(/hunter2|client\.ts/);
  });
});

// The log line's own assertions live in src/log.test.ts, so the file that owns
// the shape owns its proof. Extending the entry adds required fields, so a copy
// left here would have failed to compile anyway.
