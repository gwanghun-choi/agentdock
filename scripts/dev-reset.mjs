#!/usr/bin/env node
// scripts/dev-reset.mjs
//
// Empties the agentdock schema by running scripts/sql/dev-reset.sql as
// agentdock_app. Bun loads .env before launching this, so DATABASE_URL is
// already in the environment.
//
//   bun run db:reset --confirm

import { readFileSync } from 'node:fs';
import postgres from 'postgres';

if (!process.argv.includes('--confirm')) {
  console.error('Refusing to reset. This destroys every table in the agentdock schema.');
  console.error('Re-run as: bun run db:reset --confirm');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  connection: { search_path: 'agentdock' },
  onnotice: (notice) => console.log(notice.message),
});

try {
  await sql.unsafe("SET agentdock.allow_reset = 'yes'");
  await sql.unsafe(readFileSync(new URL('./sql/dev-reset.sql', import.meta.url), 'utf8'));
  console.log('agentdock schema emptied. Run `bun run db:migrate` to rebuild it.');
} finally {
  await sql.end();
}
