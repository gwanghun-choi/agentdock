#!/usr/bin/env node
// scripts/capture-fixtures.mjs
//
// MANUAL developer tool. Not part of `bun run ci`, never invoked by a test.
//
// Freezes the corpus the detector, parser and ingestion suites read, pinned to
// commit SHAs so a fixture cannot drift with upstream. Every test that consumes
// this output runs with no network and no token.
//
// It also asserts the finding this whole phase leans on: the sha the Trees API
// returns for a ref name is the COMMIT sha, and github.com/o/r/blob/<that>/path
// resolves. If GitHub ever changes that, this script fails here rather than the
// product failing silently with 404s on every permalink.
//
// Usage: bun scripts/capture-fixtures.mjs [slug ...]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DETECTORS } from '../src/detect/index.ts';
import { collectCandidates, orderedNeeds } from '../src/detect/run.ts';

/**
 * Which blobs a pin captures bodies for.
 *
 * `skills` is what the four Phase 4 corpora were captured with, kept verbatim so
 * re-running this script reproduces them byte for byte.
 *
 * `artifacts` is what Phase 5's three additions need, and the reason is not
 * preference. `disler/claude-code-hooks-mastery` contains **zero** SKILL.md
 * files — 21 commands and a hook config — so `skills` throws
 * "no SKILL.md in the tree" and captures nothing. And `anthropics/claude-code`
 * was chosen precisely because `allowed-tools` lives in its 18 command files;
 * under `skills` it would contribute 10 skill bodies and not one command, so
 * `declaredCapabilities` would report a second absence of data caused by this
 * filter rather than by the corpus.
 *
 * `artifacts` asks the shipped detector registry which paths it would read, so
 * the captured corpus is by construction the set of files AgentDock actually
 * ingests from that repository — the same selector src/ingest/pipeline.ts runs
 * (collectCandidates -> orderedNeeds), not a glob written here that could drift
 * from it.
 */
const BODY_SELECTORS = {
  skills: (tree) => tree.filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md')),
  artifacts: (tree) => {
    const needed = new Set(orderedNeeds(collectCandidates(DETECTORS, tree)));
    return tree.filter((e) => e.type === 'blob' && needed.has(e.path));
  },
};

const PINS = [
  {
    slug: 'anthropics-skills',
    owner: 'anthropics',
    repo: 'skills',
    sha: 'f17010c9bb483898c1d9c9f42dde2b3a98889434',
    bodies: 'all',
  },
  {
    slug: 'addyosmani-agent-skills',
    owner: 'addyosmani',
    repo: 'agent-skills',
    sha: '7676817c12a1317454ae3898a0c5c1eacf5dd3d5',
    bodies: 'all', // 24 files: the clean, specification-conformant baseline
  },
  {
    slug: 'baoyu-skills',
    owner: 'JimLiu',
    repo: 'baoyu-skills',
    sha: '6b7a2e417500561a5ecdd0b168332f4142584617',
    bodies: 'all', // 22 files: nested metadata, non-ASCII, two skill roots
  },
  {
    slug: 'wshobson-agents',
    owner: 'wshobson',
    repo: 'agents',
    sha: 'c4b82b0ad771190355eb8e204b1329732a18449a',
    // 180 SKILL.md files. match() reads paths from tree.json and never opens a
    // body, so the tree alone tests the scale case; 20 bodies are enough to
    // exercise parse() against the non-specification version field.
    bodies: 20,
  },
  // --- Phase 5 (05-05, CAP-13 re-measurement). Chosen for the shapes the four
  // above lack: zero `allowed-tools` declarations and one shared house style.
  {
    slug: 'anthropics-claude-code',
    owner: 'anthropics',
    repo: 'claude-code',
    sha: '54cc51a08a5d3900e5abd02ad75a2ce46f3f008c',
    // 333 tree entries; 46 artifact paths — 18 commands, 13 plugin manifests,
    // 10 skills, 5 hooks, 1 catalog. The commands are the point.
    select: 'artifacts',
    bodies: 'all',
  },
  {
    slug: 'disler-hooks-mastery',
    owner: 'disler',
    repo: 'claude-code-hooks-mastery',
    sha: '052ad1cbd5aeb1ec4a1def22012d1293c6225625',
    // 153 tree entries; 22 artifact paths — 21 commands and 1 hook config, and
    // NO SKILL.md at all. An independent author's conventions.
    select: 'artifacts',
    bodies: 'all',
  },
  {
    slug: 'obra-superpowers',
    owner: 'obra',
    repo: 'superpowers',
    sha: '44c9b2d6e889982ac18c27d05a19fefe335194e1',
    // 234 tree entries; 17 artifact paths — 14 skills, 1 plugin, 1 catalog,
    // 1 hook. No Anthropic adjacency.
    select: 'artifacts',
    bodies: 'all',
  },
];

const UA = { 'user-agent': 'agentdock-fixture-capture', accept: 'application/vnd.github+json' };
const auth = process.env.GITHUB_TOKEN
  ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

async function json(url) {
  const res = await fetch(url, { headers: { ...UA, ...auth } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function capture(pin) {
  const dir = join('fixtures', pin.slug);
  mkdirSync(join(dir, 'files'), { recursive: true });

  const repo = await json(`https://api.github.com/repos/${pin.owner}/${pin.repo}`);
  const tree = await json(
    `https://api.github.com/repos/${pin.owner}/${pin.repo}/git/trees/${pin.sha}?recursive=1`,
  );

  if (tree.sha !== pin.sha) {
    throw new Error(`${pin.slug}: tree sha ${tree.sha} does not match the pin ${pin.sha}`);
  }

  const select = BODY_SELECTORS[pin.select ?? 'skills'];
  const candidates = select(tree.tree);
  if (candidates.length === 0) {
    throw new Error(`${pin.slug}: the '${pin.select ?? 'skills'}' selector matched nothing`);
  }

  // The load-bearing assertion. raw.githubusercontent.com accepts both the tree
  // sha and the commit sha, so only the blob URL can catch the wrong one.
  const probe = `https://github.com/${pin.owner}/${pin.repo}/blob/${pin.sha}/${candidates[0].path}`;
  const probeRes = await fetch(probe, { redirect: 'manual' });
  if (probeRes.status !== 200) {
    throw new Error(`permalink assertion failed: ${probe} -> ${probeRes.status}`);
  }

  const wanted = pin.bodies === 'all' ? candidates : candidates.slice(0, pin.bodies);
  for (const entry of wanted) {
    const raw = `https://raw.githubusercontent.com/${pin.owner}/${pin.repo}/${pin.sha}/${entry.path}`;
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`${raw} -> ${res.status}`);
    writeFileSync(join(dir, 'files', encodeURIComponent(entry.path)), await res.text());
  }

  writeFileSync(join(dir, 'repo.json'), `${JSON.stringify(repo, null, 2)}\n`);
  writeFileSync(join(dir, 'tree.json'), `${JSON.stringify(tree, null, 2)}\n`);
  console.log(
    `${pin.slug}: ${tree.tree.length} entries, ${candidates.length} ` +
      `'${pin.select ?? 'skills'}' path(s), ${wanted.length} bodies captured, permalink 200`,
  );
}

const only = process.argv.slice(2);
for (const pin of PINS) {
  if (only.length > 0 && !only.includes(pin.slug)) continue;
  await capture(pin);
}
