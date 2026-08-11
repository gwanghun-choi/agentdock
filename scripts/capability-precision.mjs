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
// Usage: bun run precision [analyzer-name]

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredCapabilities } from '../src/analyze/declared.ts';
import { ANALYZERS } from '../src/analyze/index.ts';
import { parseFrontmatter } from '../src/detect/frontmatter.ts';

const CORPORA = ['addyosmani-agent-skills', 'anthropics-skills', 'baoyu-skills', 'wshobson-agents'];
const SAMPLE_SIZE = 20;

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

function corpusFiles() {
  const files = [];
  for (const slug of CORPORA) {
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

function run(analyzers) {
  const files = corpusFiles();
  for (const analyzer of analyzers) {
    const hits = [];
    for (const file of files) {
      const findings = analyzer(inputFor(analyzer, file.sourcePath, file.raw));
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

const only = process.argv[2];
const selected = only ? ANALYZERS.filter((a) => a.name === only) : ANALYZERS;
if (only && selected.length === 0) {
  console.error(`no registered analyzer named "${only}"`);
  process.exit(1);
}
run(selected);
