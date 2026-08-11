#!/usr/bin/env node
// scripts/verify-worker-boot.mjs
//
// Answers one question with a run rather than a reading: does register() fire
// at `next start` without a first request? Seeds a queued job whose target is
// denylisted — so the pipeline refuses it before any network call — starts the
// server, makes no HTTP request, and asserts the row reached a terminal status.
//
//   bun run verify:worker        (needs a build and a database; not part of ci)
//
// It costs zero GitHub requests out of the unauthenticated sixty-per-hour
// budget, by construction: a denylisted target never reaches the fetch.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import postgres from 'postgres';

const TARGET = 'test-owner/agentdock-boot-probe';
const WAIT_MS = 30_000;
const PORT = process.env.PROBE_PORT ?? '3123';

// The local binary, not `npx`: npx resolves through a registry client this
// project does not otherwise use, and the answer must not depend on that.
const NEXT_BIN = 'node_modules/.bin/next';
if (!existsSync(NEXT_BIN)) {
  console.error(`verify-worker-boot: ${NEXT_BIN} is missing. Run bun install first.`);
  process.exit(1);
}
if (!existsSync('.next')) {
  console.error('verify-worker-boot: no build found. Run `bun run build` first.');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, {
  connection: { search_path: 'agentdock' },
  onnotice: () => {},
});

async function clean() {
  await sql`DELETE FROM ingest_job WHERE target = ${TARGET}`;
  await sql`DELETE FROM repository_denylist WHERE full_name = ${TARGET}`;
}

let server;
try {
  await clean();
  await sql`INSERT INTO repository_denylist (full_name, reason) VALUES (${TARGET}, 'boot probe')`;
  const [job] = await sql`
    INSERT INTO ingest_job (target) VALUES (${TARGET}) RETURNING id
  `;

  server = spawn(NEXT_BIN, ['start', '-p', PORT], {
    stdio: 'inherit',
    env: { ...process.env },
  });

  const deadline = Date.now() + WAIT_MS;
  let status = 'queued';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    const [row] = await sql`SELECT status FROM ingest_job WHERE id = ${job.id}`;
    status = row.status;
    if (status === 'succeeded' || status === 'failed') break;
  }

  if (status === 'succeeded' || status === 'failed') {
    console.log(`verify-worker-boot: OK — the job reached "${status}" with no HTTP request made.`);
  } else {
    console.error(
      `verify-worker-boot: the job is still "${status}" after ${WAIT_MS / 1000}s with no ` +
        'request served. register() does not fire at boot in this configuration — apply the ' +
        'fallback recorded in the plan.',
    );
    process.exitCode = 1;
  }
} finally {
  server?.kill('SIGTERM');
  await clean();
  await sql.end();
}
