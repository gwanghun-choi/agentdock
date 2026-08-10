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

  const skills = tree.tree.filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'));
  if (skills.length === 0) throw new Error(`${pin.slug}: no SKILL.md in the tree`);

  // The load-bearing assertion. raw.githubusercontent.com accepts both the tree
  // sha and the commit sha, so only the blob URL can catch the wrong one.
  const probe = `https://github.com/${pin.owner}/${pin.repo}/blob/${pin.sha}/${skills[0].path}`;
  const probeRes = await fetch(probe, { redirect: 'manual' });
  if (probeRes.status !== 200) {
    throw new Error(`permalink assertion failed: ${probe} -> ${probeRes.status}`);
  }

  const wanted = pin.bodies === 'all' ? skills : skills.slice(0, pin.bodies);
  for (const entry of wanted) {
    const raw = `https://raw.githubusercontent.com/${pin.owner}/${pin.repo}/${pin.sha}/${entry.path}`;
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`${raw} -> ${res.status}`);
    writeFileSync(join(dir, 'files', encodeURIComponent(entry.path)), await res.text());
  }

  writeFileSync(join(dir, 'repo.json'), `${JSON.stringify(repo, null, 2)}\n`);
  writeFileSync(join(dir, 'tree.json'), `${JSON.stringify(tree, null, 2)}\n`);
  console.log(
    `${pin.slug}: ${tree.tree.length} entries, ${skills.length} SKILL.md, ` +
      `${wanted.length} bodies captured, permalink 200`,
  );
}

const only = process.argv.slice(2);
for (const pin of PINS) {
  if (only.length > 0 && !only.includes(pin.slug)) continue;
  await capture(pin);
}
