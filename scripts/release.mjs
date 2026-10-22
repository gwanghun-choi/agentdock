#!/usr/bin/env node
// scripts/release.mjs
//
// The two decisions .github/workflows/deploy.yml makes that are not a single
// command, kept here so they run — and are tested — outside a runner.
//
//   bun scripts/release.mjs gate          may this run deploy $SHA at all?
//   bun scripts/release.mjs smoke <url> [sha]   does production answer, from this sha?
//
// `gate` reads GitHub's API through GITHUB_API_URL, which every runner sets,
// so no GitHub hostname is written here (AGENTS.md: they live in src/github/).
// Neither command writes anything anywhere.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param {{ sha: string, tip: string | null, ciSucceeded: boolean, productionSha: string | null }} f
 * @returns {'BLOCKED_CI' | 'SUPERSEDED' | 'ALREADY_DEPLOYED' | 'DEPLOY'}
 */
export function decideRelease({ sha, tip, ciSucceeded, productionSha }) {
  // This sha's own push CI, never another sha's or another event's.
  if (!ciSucceeded) return 'BLOCKED_CI';
  // A run for an older commit that finishes — or is re-run — after a newer one
  // was pushed must not put the older code back. The newer push has its own
  // CI and its own deploy run queued behind this one.
  if (tip !== sha) return 'SUPERSEDED';
  // The same push delivered twice (CI #24 and #25 on 0602d99) or a re-run.
  if (productionSha === sha) return 'ALREADY_DEPLOYED';
  return 'DEPLOY';
}

/** The commit a deployment says it was built from (next.config.ts), or null. */
export async function servedCommit(base, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(new URL('/', base), { method: 'HEAD', redirect: 'manual' });
    return res.headers.get('x-agentdock-commit');
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {typeof fetch} [fetchImpl]
 */
async function gate(env = process.env, fetchImpl = fetch) {
  const { SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_API_URL: api, GITHUB_TOKEN: token } = env;
  const branch = env.DEPLOY_BRANCH ?? 'develop';
  if (!sha || !repo || !api || !token) {
    throw new Error('gate needs SHA, GITHUB_REPOSITORY, GITHUB_API_URL and GITHUB_TOKEN');
  }
  const get = async (path) => {
    const res = await fetchImpl(`${api}/repos/${repo}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path.split('?')[0]}`);
    return res.json();
  };
  const runs = await get(
    `actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=${branch}&status=success&per_page=1`,
  );
  const ref = await get(`git/ref/heads/${branch}`);
  const productionSha = env.PRODUCTION_URL
    ? await servedCommit(env.PRODUCTION_URL, fetchImpl)
    : null;
  const decision = decideRelease({
    sha,
    tip: ref.object?.sha ?? null,
    ciSucceeded: runs.total_count > 0,
    productionSha,
  });
  console.log(
    `gate: ${decision} — sha ${sha.slice(0, 7)}, ${branch} at ${String(ref.object?.sha).slice(0, 7)}, ` +
      `production serves ${productionSha ? productionSha.slice(0, 7) : 'an unidentified build'}`,
  );
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `decision=${decision}\n`);
  return decision;
}

// The type filter's ids — ARTIFACT_TYPE_IDS in src/db/queries/search.ts, which
// this file cannot import (it loads the database client). release.test.ts
// fails if the two drift. Which of them hold rows is production's fact, not
// this file's: an empty type is reported, and only "every type empty" fails.
export const TYPES = ['skill', 'plugin', 'mcp_server', 'command', 'hook', 'agent'];
const ERROR_PAGE = 'Something went wrong'; // src/app/error.tsx
const EMPTY_CORPUS = 'No artifacts indexed yet'; // src/app/artifacts/page.tsx
const NO_MATCH = 'No artifacts matched';

/**
 * @param {string} base
 * @param {string | undefined} sha
 * @returns {Promise<{ ok: boolean, lines: string[] }>}
 */
export async function smoke(base, sha, { fetchImpl = fetch, attempts = 6, delayMs = 10_000 } = {}) {
  const lines = [];
  let ok = true;
  const fail = (line) => {
    ok = false;
    lines.push(`FAIL ${line}`);
  };

  // The alias moves when the build is ready, but a CDN edge may answer from
  // the previous deployment for a few seconds.
  if (sha) {
    let served = null;
    for (let i = 0; i < attempts; i += 1) {
      served = await servedCommit(base, fetchImpl);
      if (served === sha) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    if (served === sha) lines.push(`ok   identity ${sha.slice(0, 7)}`);
    else {
      fail(
        `identity: production serves ${served ? served.slice(0, 7) : 'no commit header'}, expected ${sha.slice(0, 7)}` +
          ' — if the project was rolled back, Vercel stopped assigning the domain (undo the rollback)',
      );
    }
  }

  const page = async (path, check) => {
    const started = Date.now();
    try {
      const res = await fetchImpl(new URL(path, base), { redirect: 'manual' });
      const body = res.status === 200 ? await res.text() : '';
      const ms = Date.now() - started;
      const problem = check(res, body);
      if (problem) fail(`${path}: ${problem}`);
      else lines.push(`ok   ${path} ${res.status} ${ms}ms`);
      return body;
    } catch (error) {
      fail(`${path}: ${error?.cause?.code ?? error?.code ?? error?.name ?? 'request failed'}`);
      return '';
    }
  };
  const rendered = (res, body) =>
    res.status !== 200
      ? `HTTP ${res.status}`
      : body.includes(ERROR_PAGE)
        ? 'rendered the error boundary (the index could not be read)'
        : null;

  await page('/', rendered);
  // An empty corpus on a deployment that has been serving one means the
  // connection reaches a different database or schema.
  await page(
    '/artifacts',
    (res, body) =>
      rendered(res, body) ?? (body.includes(EMPTY_CORPUS) ? 'the corpus is empty' : null),
  );
  await page('/artifacts?q=mcp', rendered);
  await page('/skills', (res) => (res.status === 308 ? null : `HTTP ${res.status}, expected 308`));

  const empty = [];
  for (const type of TYPES) {
    const body = await page(`/artifacts?type=${type}`, rendered);
    if (body.includes(NO_MATCH)) empty.push(type);
  }
  if (empty.length > 0) lines.push(`note no rows of type: ${empty.join(', ')}`);
  if (empty.length === TYPES.length) fail('every artifact type is empty');

  return { ok, lines };
}

async function main() {
  const [command, base, sha] = process.argv.slice(2);
  if (command === 'gate') {
    await gate();
    return;
  }
  if (command === 'smoke' && base) {
    const result = await smoke(base, sha || undefined);
    for (const line of result.lines) console.log(line);
    console.log(result.ok ? 'smoke: PASS' : 'smoke: FAIL');
    if (!result.ok) process.exitCode = 1;
    return;
  }
  console.error('usage: release.mjs gate | release.mjs smoke <base-url> [sha]');
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  });
}

export { gate };
