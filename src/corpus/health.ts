import type { IngestOutcome } from '@/ingest/errors';
import { type Disposition, dispositionFor } from '@/ingest/retry';

/**
 * What `bun run ops:status` reports, and the one judgement it makes: whether
 * the scheduled sync is running and finishing. Pure, so it is testable without
 * a database or a clock; src/db/queries/opsReport.ts reads the numbers.
 *
 * Operator-facing only. Nothing here reaches a page: AgentDock has no sign-in,
 * so a public status page could show only what the home page already does (the
 * listing counts and "last sync without errors").
 */

/** schema_meta's sync:last_attempt, as corpus-sync.mjs writes it. */
export type LastAttempt = Record<string, string | number | boolean | null | string[]>;

export type SyncReport = {
  generatedAt: Date;
  /** The attempt window, in hours, every `attempts` and `artifacts.*InWindow` figure covers. */
  windowHours: number;
  lastAttempt: LastAttempt | null;
  lastSuccessAt: Date | null;
  /** Every ingest_job row by its CURRENT status — not what any one run did. */
  queue: {
    queued: number;
    due: number;
    running: number;
    /** Running longer than the reaper's cutoff: a worker that died mid-job. */
    runningAbandoned: number;
    succeeded: number;
    failed: number;
  };
  /** ingest_attempt rows that FINISHED inside the window, whichever run wrote them. */
  attempts: {
    total: number;
    byOutcome: Record<string, number>;
    p50Ms: number | null;
    p95Ms: number | null;
    truncated: number;
    artifactsNew: number;
    artifactsUpdated: number;
    artifactsUnchanged: number;
    artifactsRemoved: number;
  };
  artifacts: {
    held: number;
    listed: number;
    byType: Record<string, number>;
    /** package.created_at inside the window: first indexed by AgentDock. */
    addedInWindow: number;
    /** A second or later content version recorded inside the window. */
    changedInWindow: number;
  };
};

export type HealthState = 'OK' | 'PARTIAL' | 'DEGRADED' | 'UNKNOWN';

/** 36 h: two missed runs of a twelve-hour schedule, plus GitHub's late starts. */
export const DEFAULT_STALE_HOURS = 36;

const hoursSince = (at: Date, now: Date) => (now.getTime() - at.getTime()) / 3_600_000;

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The sync's state, from the two rows corpus-sync.mjs writes. About the sync,
 * never the site: a stale index is still a working index, so the worst this
 * says is DEGRADED, with the reason.
 *
 * - UNKNOWN: neither row exists — no scheduled run has recorded anything.
 * - DEGRADED: the last run failed, or no run (or no clean run) in staleHours.
 * - PARTIAL: the last run stopped at a limit (PARTIAL_*) or drained nothing.
 * - OK: the last run reached COMPLETED, recently.
 */
export function syncHealth(
  report: Pick<SyncReport, 'lastAttempt' | 'lastSuccessAt'>,
  now: Date,
  staleHours: number = DEFAULT_STALE_HOURS,
): { state: HealthState; reasons: string[] } {
  const { lastAttempt, lastSuccessAt } = report;
  if (!lastAttempt && !lastSuccessAt) {
    return { state: 'UNKNOWN', reasons: ['no scheduled sync has recorded a run'] };
  }
  const degraded: string[] = [];
  if (lastAttempt?.ok === false) {
    const stages = Array.isArray(lastAttempt.failedStages) ? lastAttempt.failedStages : [];
    degraded.push(
      `the last run failed${stages.length > 0 ? ` (stages: ${stages.join(', ')})` : ''}`,
    );
  }
  const lastRun = dateOf(lastAttempt?.startedAt);
  if (lastRun && hoursSince(lastRun, now) > staleHours) {
    degraded.push(`no run recorded in the last ${staleHours} h`);
  }
  if (!lastSuccessAt || hoursSince(lastSuccessAt, now) > staleHours) {
    degraded.push(`no run without errors in the last ${staleHours} h`);
  }
  if (degraded.length > 0) return { state: 'DEGRADED', reasons: degraded };

  const status = typeof lastAttempt?.status === 'string' ? lastAttempt.status : null;
  if (status && status !== 'COMPLETED') {
    return { state: 'PARTIAL', reasons: [`the last run ended ${status}`] };
  }
  return { state: 'OK', reasons: [] };
}

/**
 * An attempt outcome's disposition, from retry.ts's total record — the same
 * classification the worker acts on, not a second one. `unchanged` is the
 * no-change short circuit, a success; a string the union does not know (a row
 * from a future version) is reported as itself rather than guessed at.
 */
export function outcomeCategory(outcome: string): Disposition | 'unknown' {
  if (outcome === 'unchanged') return 'succeeded';
  return dispositionFor(outcome as IngestOutcome) ?? 'unknown';
}

const CATEGORY_LABEL: Record<Disposition | 'unknown', string> = {
  succeeded: 'finished (includes declined by discovery policy)',
  terminal: 'failed, not retried',
  retryable: 'failed, retried',
  rate_limited: 'deferred by a rate limit',
  unknown: 'outcome not recognised by this version',
};

const percent = (n: number, of: number) => (of === 0 ? 'n/a' : `${((100 * n) / of).toFixed(1)}%`);
const seconds = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
const utc = (at: Date | null) =>
  at ? `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never';

/**
 * The report as label/value sections — one shape for both renderings below, so
 * the terminal and the Actions summary cannot say different things.
 */
export function reportSections(
  report: SyncReport,
  staleHours: number = DEFAULT_STALE_HOURS,
): { title: string; rows: [string, string][] }[] {
  const health = syncHealth(report, report.generatedAt, staleHours);
  const last = report.lastAttempt;
  const num = (key: string) => (typeof last?.[key] === 'number' ? String(last[key]) : 'n/a');
  const a = report.attempts;

  const categories = new Map<string, number>();
  for (const [outcome, n] of Object.entries(a.byOutcome)) {
    const label = CATEGORY_LABEL[outcomeCategory(outcome)];
    categories.set(label, (categories.get(label) ?? 0) + n);
  }

  return [
    {
      title: 'Health',
      rows: [
        ['Sync state', health.state],
        ...health.reasons.map((r): [string, string] => ['  because', r]),
        ['Judged against', `${staleHours} h without a clean run`],
      ],
    },
    {
      title: 'Last scheduled run (schema_meta sync:last_attempt)',
      rows: last
        ? [
            ['Started', utc(dateOf(last.startedAt))],
            ['Status', String(last.status ?? 'n/a')],
            ['Duration', last.durationSeconds == null ? 'n/a' : `${last.durationSeconds}s`],
            ['Repositories processed', num('processed')],
            ['  ingested (new or changed)', num('ingested')],
            ['  unchanged', num('unchanged')],
            ['  could not be read', num('unreadable')],
            ['  rate limited', num('rateLimited')],
            ['Enqueued', num('enqueued')],
            ['Queued after the drain', `${num('queued')} (${num('due')} due)`],
            ['Drain stopped by', String(last.drainStoppedBy ?? 'its cap or an empty queue')],
            ['Last run without errors', utc(report.lastSuccessAt)],
          ]
        : [['Recorded', 'no run recorded yet']],
    },
    {
      title: 'Queue now (every ingest_job row, by current status)',
      rows: [
        ['Queued', `${report.queue.queued} (${report.queue.due} due now)`],
        ['Running', String(report.queue.running)],
        ['  past the reaper cutoff', String(report.queue.runningAbandoned)],
        ['Succeeded', String(report.queue.succeeded)],
        ['Failed', String(report.queue.failed)],
      ],
    },
    {
      title: `Attempts finished in the last ${report.windowHours} h (any run)`,
      rows: [
        ['Attempts', String(a.total)],
        ...[...categories].map(([label, n]): [string, string] => [
          `  ${label}`,
          `${n} (${percent(n, a.total)})`,
        ]),
        ...Object.entries(a.byOutcome)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([outcome, n]): [string, string] => [`    ${outcome}`, String(n)]),
        ['Per attempt', `p50 ${seconds(a.p50Ms)}, p95 ${seconds(a.p95Ms)}`],
        ['Partial reads (tree or file cap)', String(a.truncated)],
        [
          'Artifacts new / updated / unchanged / removed',
          `${a.artifactsNew} / ${a.artifactsUpdated} / ${a.artifactsUnchanged} / ${a.artifactsRemoved}`,
        ],
      ],
    },
    {
      title: 'Corpus now',
      rows: [
        ['Artifacts listed', `${report.artifacts.listed} of ${report.artifacts.held} held`],
        ...Object.entries(report.artifacts.byType)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([type, n]): [string, string] => [`  ${type}`, String(n)]),
        [
          `First indexed in the last ${report.windowHours} h`,
          String(report.artifacts.addedInWindow),
        ],
        [
          `Content changed in the last ${report.windowHours} h`,
          String(report.artifacts.changedInWindow),
        ],
      ],
    },
  ];
}

/** A cron mail or a terminal. */
export function formatText(report: SyncReport, staleHours?: number): string {
  const lines = [`AgentDock sync health — ${utc(report.generatedAt)}`];
  for (const section of reportSections(report, staleHours)) {
    lines.push('', section.title);
    for (const [label, value] of section.rows) lines.push(`  ${label.padEnd(46)}${value}`);
  }
  return `${lines.join('\n')}\n`;
}

// Every value is a number, a date or a word this file chose, but a stage name
// or a status read back from schema_meta is still data: a `|` would split a
// cell, and `<` would start markup in the rendered summary.
const cell = (value: string) =>
  value.replace(/[|\\`*_<>[\]]/g, (c) => `\\${c}`).replace(/\s+/g, ' ');

/** $GITHUB_STEP_SUMMARY, which renders GitHub-flavoured Markdown. */
export function formatMarkdown(report: SyncReport, staleHours?: number): string {
  const out = [`## AgentDock sync health`, '', `Generated ${utc(report.generatedAt)}.`];
  for (const section of reportSections(report, staleHours)) {
    out.push('', `### ${cell(section.title)}`, '', '| | |', '|---|---|');
    // A table cell drops leading spaces, so the text form's indentation becomes a marker.
    for (const [label, value] of section.rows) {
      const depth = (label.length - label.trimStart().length) / 2;
      out.push(`| ${'· '.repeat(depth)}${cell(label.trim())} | ${cell(value)} |`);
    }
  }
  return `${out.join('\n')}\n`;
}
