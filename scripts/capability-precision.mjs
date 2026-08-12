#!/usr/bin/env node
// scripts/capability-precision.mjs
//
// Runs the shipped analyzer registry (src/analyze/index.ts) over the four
// frozen corpora and prints, per analyzer: the total hit count, and the
// first twenty hits (or all of them, when fewer than twenty exist) as
// `corpus/file:line` plus the matched text — so the CAP-13 hand-check is
// reproducible rather than remembered.
//
// No network, no token, no database: the corpora are on disk
// (fixtures/*/files/*) and every analyzer is a one-parameter pure function.
// Not wired into `ci` — the hand-check is a human step by definition, and a
// script that prints a sample has nothing to fail on.
// src/analyze/precision.test.ts is what runs in CI, checking the RECORD
// this script's output feeds (fixtures/capability-precision.md), not this
// script's own output.
//
// Usage: bun run precision [analyzer-name] [--set=v1|v2] [--signal=npx|not-npx]
//
// --set selects which frozen corpus set to sample (default: the newest). It is
// printed on every run: a hand-check made against the wrong corpus is otherwise
// undetectable, and that is exactly the failure 05-CONTEXT C4 names.
//
// --signal filters findings by Finding.signal, which is what makes the `npx`
// question measurable without touching a detector: install.ts:44 already writes
// the matched literal as the signal, so `npx` hits are already distinguishable
// from `pip install` hits. `not-npx` is the complement. Same predicate
// src/analyze/precision.test.ts applies for a row scoped to `npx`/`not-npx`.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_SETS, NEWEST_CORPUS_SET } from '../src/analyze/corpora.ts';
import { declaredCapabilities } from '../src/analyze/declared.ts';
import { ANALYZERS } from '../src/analyze/index.ts';
import { parseFrontmatter } from '../src/detect/frontmatter.ts';

const SAMPLE_SIZE = 20;

/** Keep in step with precision.test.ts's scope filter. One token each. */
const SIGNAL_FILTERS = {
  npx: (f) => f.signal === 'npx',
  'not-npx': (f) => f.signal !== 'npx',
};

/**
 * declaredCapabilities reads structured frontmatter, never body text — every
 * other shipped analyzer scans the raw file text (frontmatter block
 * included, matching src/analyze/install.test.ts's own corpus convention).
 * This is the one place the script must build a different AnalyzeInput per
 * analyzer rather than a single shared one.
 */
function inputFor(analyzer, sourcePath, raw) {
  if (analyzer === declaredCapabilities) {
    const parsed = parseFrontmatter(raw, sourcePath);
    return { sourcePath, body: '', frontmatter: parsed.ok ? parsed.data : {}, meta: {}, files: [] };
  }
  return { sourcePath, body: raw, frontmatter: {}, meta: {}, files: [] };
}

function corpusFiles(corpora) {
  const files = [];
  for (const slug of corpora) {
    const dir = join('fixtures', slug, 'files');
    for (const name of readdirSync(dir)) {
      files.push({
        slug,
        sourcePath: decodeURIComponent(name),
        raw: readFileSync(join(dir, name), 'utf8'),
      });
    }
  }
  return files;
}

function run(analyzers, setName, signalFilter) {
  const corpora = CORPUS_SETS[setName];
  const files = corpusFiles(corpora);
  console.log(
    `corpus set ${setName}: ${corpora.length} frozen corpora (${corpora.join(', ')}), ` +
      `${files.length} file(s)${signalFilter ? ` — signal filter: ${signalFilter}` : ''}`,
  );

  for (const analyzer of analyzers) {
    const hits = [];
    const bySignal = new Map();
    for (const file of files) {
      let findings = analyzer(inputFor(analyzer, file.sourcePath, file.raw));
      for (const finding of findings) {
        bySignal.set(
          finding.signal ?? '(none)',
          (bySignal.get(finding.signal ?? '(none)') ?? 0) + 1,
        );
      }
      if (signalFilter) findings = findings.filter(SIGNAL_FILTERS[signalFilter]);
      for (const finding of findings) {
        hits.push({
          location:
            finding.startLine === null
              ? `${file.slug}/${file.sourcePath}`
              : `${file.slug}/${file.sourcePath}:${finding.startLine}`,
          category: finding.category,
          text: finding.evidenceText ?? finding.summary,
        });
      }
    }

    console.log(`\n=== ${analyzer.name} — ${hits.length} hit(s) total ===`);

    // The signal tally is always over the UNFILTERED findings, so one run
    // answers "how do the hits split" without a second invocation. It is the
    // breakdown the npx taxonomy decision needs, and it costs nothing: every
    // Finding already carries a signal.
    if (bySignal.size > 1) {
      const tally = [...bySignal.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`  signals: ${tally.map(([s, n]) => `${s}=${n}`).join(' ')}`);
    }

    // Grouped by category, not just by analyzer: observedNetwork emits two
    // distinct claims (network_request, external_reference) from one
    // function, and CONTEXT.md's own decision 6 records a separate rate for
    // each — the sample must let a human hand-check each claim on its own
    // hits, not a blend of the two.
    const byCategory = new Map();
    for (const hit of hits) {
      if (!byCategory.has(hit.category)) byCategory.set(hit.category, []);
      byCategory.get(hit.category).push(hit);
    }
    for (const [category, categoryHits] of byCategory) {
      console.log(`\n  -- ${category}: ${categoryHits.length} hit(s) --`);
      if (categoryHits.length <= SAMPLE_SIZE) {
        console.log(`  (fewer than ${SAMPLE_SIZE} exist; the sample below is all of them)`);
      }
      for (const hit of categoryHits.slice(0, SAMPLE_SIZE)) {
        console.log(`    ${hit.location} — ${hit.text}`);
      }
    }
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const setName = flag('set') ?? NEWEST_CORPUS_SET;
if (!CORPUS_SETS[setName]) {
  console.error(`no corpus set named "${setName}" — have: ${Object.keys(CORPUS_SETS).join(', ')}`);
  process.exit(1);
}

const signalFilter = flag('signal');
if (signalFilter && !SIGNAL_FILTERS[signalFilter]) {
  console.error(`no signal filter named "${signalFilter}" — have: npx, not-npx`);
  process.exit(1);
}

const only = args.find((a) => !a.startsWith('--'));
const selected = only ? ANALYZERS.filter((a) => a.name === only) : ANALYZERS;
if (only && selected.length === 0) {
  console.error(`no registered analyzer named "${only}"`);
  process.exit(1);
}
run(selected, setName, signalFilter);
