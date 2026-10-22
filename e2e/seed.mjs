// e2e/seed.mjs
//
// The browser journeys' database: the seven committed fixtures the search
// evaluation also reads, plus e2e/fixtures/ui-edge-cases, a synthetic
// repository holding what no captured fixture does — subagents, an MCP
// declaration and a hook settings file whose credentials are invented (for the
// redaction journeys), a command named `c#-review.md`, a plugin that contains a
// subagent and a skill, and an 87-character name. All of it through the real ingestion pipeline, offline:
// `fetch` is replaced before the pipeline is imported, the same way
// scripts/seed-fixture.mjs does it, and any other host throws.
//
// Only into the disposable test database. The URL comes from TEST_DATABASE_URL
// and must pass the same allowlist every test suite does (src/db/testDatabase.ts),
// whatever DATABASE_URL a shell or a .env holds. The schema is `agentdock`,
// which `bun run db:test:migrations` builds from the reviewed drizzle/ files —
// the schema a deployment runs, so the pages read what production would.
//
// Usage: TEST_DATABASE_URL=… bun run e2e:seed

import { readFileSync } from 'node:fs';
import { assertTestDatabaseUrl } from '../src/db/testDatabase.ts';

process.env.DATABASE_URL = assertTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
  'TEST_DATABASE_URL',
);
process.env.DATABASE_SCHEMA = 'agentdock';

const DIRS = [
  'addyosmani-agent-skills',
  'anthropics-claude-code',
  'anthropics-skills',
  'baoyu-skills',
  'disler-hooks-mastery',
  'obra-superpowers',
  'wshobson-agents',
]
  .map((name) => `fixtures/${name}`)
  .concat('e2e/fixtures/ui-edge-cases');

let dir = '';
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.github.com') {
    if (url.pathname.includes('/git/trees/')) return new Response(readFileSync(`${dir}/tree.json`));
    if (url.pathname.includes('/commits/')) {
      const { sha } = JSON.parse(readFileSync(`${dir}/tree.json`, 'utf8'));
      return Response.json({ sha });
    }
    return new Response(readFileSync(`${dir}/repo.json`));
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
    return new Response(readFileSync(`${dir}/files/${encodeURIComponent(path)}`, 'utf8'));
  }
  throw new Error(`e2e seed: refusing to contact ${url.hostname}`);
};

const { ingestRepository } = await import('../src/ingest/pipeline.ts');
const { sql } = await import('../src/db/client.ts');

let failed = false;
for (dir of DIRS) {
  const { full_name: fullName } = JSON.parse(readFileSync(`${dir}/repo.json`, 'utf8'));
  const result = await ingestRepository(fullName);
  console.log(
    `seeded ${fullName}: ${result.ok ? 'ok' : 'FAILED'} ${JSON.stringify(result.stored ?? '')}`,
  );
  failed ||= !result.ok;
}
await sql.end();
if (failed) process.exit(1);
