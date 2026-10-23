#!/usr/bin/env node
// scripts/ops.mjs
//
// Two read-only operator reports over the database the sync writes. Neither
// changes a row, starts a job or calls GitHub; both open their connections with
// default_transaction_read_only=on, so PostgreSQL refuses a write even if one
// were ever added here by mistake.
//
//   bun run ops:status       is the scheduled sync running and finishing? The
//                            last run, the queue now, the attempts in a window,
//                            the corpus counts. Exit 0 whenever it could read.
//   bun run quality:check    integrity rules and corpus observations
//                            (src/db/queries/quality.ts). Exit 1 if a rule that
//                            must hold does not.
//
// Both: exit 2 when the database could not be read. The error's code is
// printed, never its message — a connection error's message can carry a host
// name, and a statement error's can carry values.
//
// Neither is public. AgentDock has no sign-in, so operator detail stays in a
// terminal, a cron mail or the sync workflow's run summary (sync.yml), which
// prints `ops:status --markdown` — counts and statuses, no repository names.
//
// Usage:
//   bun run ops:status    [--hours=<n>] [--stale-hours=<n>] [--json | --markdown]
//   bun run quality:check [--repo=<owner/repo prefix>] [--stale-days=<n>] [--samples=<n>] [--json]

const [mode, ...args] = process.argv.slice(2);

/** Hand-parsed off process.argv, validated inline. No CLI library, ever. */
function flag(name) {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? '' : hit.slice(eq + 1);
}

function count(name, fallback) {
  const raw = flag(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`ops: --${name} must be a positive integer, got "${raw}"`);
    process.exit(2);
  }
  return n;
}

if (mode !== 'status' && mode !== 'quality') {
  console.error('ops: usage: scripts/ops.mjs status|quality [flags]');
  process.exit(2);
}

// Read-only at the server, as a startup parameter: postgres.js sends a URL's
// query parameters as connection parameters, and src/db/client.ts reads this
// variable once at import, so every pooled connection carries it.
try {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.searchParams.set('default_transaction_read_only', 'on');
  process.env.DATABASE_URL = url.href;
} catch {
  console.error('ops: DATABASE_URL is missing or not a URL.');
  process.exit(2);
}

let exitCode = 0;
let sql;
try {
  ({ sql } = await import('../src/db/client.ts'));
  if (mode === 'status') {
    const { readSyncReport } = await import('../src/db/queries/opsReport.ts');
    const { REAP_AFTER_MS } = await import('../src/ingest/worker.ts');
    const { DEFAULT_STALE_HOURS, formatMarkdown, formatText, syncHealth } = await import(
      '../src/corpus/health.ts'
    );
    const staleHours = count('stale-hours', DEFAULT_STALE_HOURS);
    const report = await readSyncReport({
      windowHours: count('hours', 24),
      reapAfterMs: REAP_AFTER_MS,
    });
    if (flag('json') !== undefined) {
      const health = syncHealth(report, report.generatedAt, staleHours);
      console.log(JSON.stringify({ ...report, health }, null, 2));
    } else if (flag('markdown') !== undefined) {
      process.stdout.write(formatMarkdown(report, staleHours));
    } else {
      process.stdout.write(formatText(report, staleHours));
    }
  } else {
    const { runQualityChecks } = await import('../src/db/queries/quality.ts');
    const repo = flag('repo') || undefined;
    const staleDays = count('stale-days', 14);
    const started = Date.now();
    const checks = await runQualityChecks({ repo, staleDays, sampleSize: count('samples', 5) });
    const violations = checks.filter((c) => c.kind === 'violation' && c.count > 0);
    if (flag('json') !== undefined) {
      console.log(
        JSON.stringify({ scope: repo ?? 'all repositories', staleDays, checks }, null, 2),
      );
    } else {
      console.log(
        `AgentDock data quality — ${repo ? `repositories starting "${repo}"` : 'all repositories'}`,
      );
      for (const kind of ['violation', 'observation']) {
        console.log('');
        console.log(kind === 'violation' ? 'Rules that must hold (expected 0)' : 'Observations');
        for (const c of checks.filter((x) => x.kind === kind)) {
          console.log(`  ${c.id.padEnd(34)}${String(c.count).padStart(6)}  ${c.about}`);
          for (const s of c.samples) {
            // JSON.stringify: a path is repository data, and a control
            // character in one must print as an escape, not act on the terminal.
            console.log(`      ${JSON.stringify(s.label)}${s.n === 1 ? '' : ` × ${s.n}`}`);
          }
          const shown = c.samples.reduce((n, s) => n + s.n, 0);
          if (shown < c.count) console.log(`      … ${c.count - shown} more not shown (--samples)`);
        }
      }
      console.log('');
      console.log(
        `${violations.length === 0 ? 'No rule violated' : `${violations.length} rule(s) violated`}` +
          ` · ${checks.length} checks in ${Date.now() - started} ms · read-only, nothing was changed`,
      );
    }
    if (violations.length > 0) exitCode = 1;
  }
} catch (error) {
  // Drizzle wraps the driver's error, and the wrapper's message is the statement.
  const raw = error?.cause?.code ?? error?.code;
  const code = typeof raw === 'string' && /^[A-Z0-9_]+$/i.test(raw) ? raw : 'unknown';
  console.error(`ops: could not read the database (error code ${code}).`);
  exitCode = 2;
}
// A bounded close: after a refused connection the pool's other queries are
// still retrying, and an unbounded end() waited on them indefinitely.
await sql?.end({ timeout: 1 });
process.exit(exitCode);
