#!/usr/bin/env node
// scripts/seed-fixture.mjs
//
// Puts a frozen fixture into the database through the real ingestion pipeline,
// so a developer has realistic rows without spending any of the
// 60-requests-per-hour unauthenticated budget. Reads only committed fixture
// files; opens no network connection — `fetch` is replaced before the pipeline
// is imported, and any host the fixture does not cover throws rather than
// resolving.
//
// Usage: bun run db:seed [fixture-name]

import { readFileSync } from 'node:fs';

const dir = `fixtures/${process.argv[2] ?? 'anthropics-skills'}`;
const repoJson = readFileSync(`${dir}/repo.json`, 'utf8');
const treeJson = readFileSync(`${dir}/tree.json`, 'utf8');
const { full_name: fullName } = JSON.parse(repoJson);

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.github.com') {
    const body = url.pathname.includes('/git/trees/') ? treeJson : repoJson;
    return new Response(body, { status: 200 });
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    const path = decodeURIComponent(url.pathname.split('/').slice(4).join('/'));
    return new Response(readFileSync(`${dir}/files/${encodeURIComponent(path)}`, 'utf8'), {
      status: 200,
    });
  }
  throw new Error(`seed: refusing to contact ${url.hostname}`);
};

const { ingestRepository } = await import('../src/ingest/pipeline.ts');
const { sql } = await import('../src/db/client.ts');

const result = await ingestRepository(fullName);
console.log(`seeded ${fullName}: ${JSON.stringify(result)}`);
await sql.end();
if (!result.ok) process.exit(1);
