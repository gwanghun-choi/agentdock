#!/usr/bin/env node
// scripts/analyze-backfill.mjs
//
// Runs analyzePackageVersion over every package_version whose analyzed_at is
// still null — the entire corpus ingested before this phase shipped, since
// Phase 2's idempotency means re-ingesting an unchanged repository mints no
// new version row and therefore no findings (04-CONTEXT.md Binding decision
// 9). Reads stored bytes only; issues no GitHub request, spends none of the
// 60-requests-per-hour budget. Follows scripts/seed-fixture.mjs's own shape:
// `await import('../src/...')` under bun, so both scripts share Bun's .env
// loading and TypeScript execution with no build step.
//
// Usage: bun run analyze:backfill [limit]

const limitArg = process.argv[2];
const limit = limitArg === undefined ? 500 : Number(limitArg);
if (!Number.isFinite(limit) || limit <= 0) {
  throw new Error(`analyze-backfill: limit must be a positive number, got "${limitArg}"`);
}

const { analyzePackageVersion, unanalyzedVersionIds } = await import('../src/ingest/reanalyze.ts');
const { sql } = await import('../src/db/client.ts');

const ids = await unanalyzedVersionIds(limit);
console.log(`analyze-backfill: ${ids.length} version(s) with analyzed_at null (limit ${limit})`);

let findingsCreated = 0;
const started = Date.now();
for (const id of ids) {
  findingsCreated += await analyzePackageVersion(id);
}

console.log(
  `analyze-backfill: analyzed ${ids.length} version(s), ${findingsCreated} finding(s) created, ` +
    `${Date.now() - started}ms`,
);

await sql.end();
