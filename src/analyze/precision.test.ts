import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '@/detect/frontmatter';
import { CORPUS_SETS } from './corpora';
import { declaredCapabilities } from './declared';
import { ANALYZERS } from './index';
import { install } from './install';
import { observedNetwork } from './network';
import { observedRemoteExecution } from './shell';
import type { AnalyzeInput } from './types';

const RECORD_PATH = join('fixtures', 'capability-precision.md');
const KILL_LINE = 20;

type Row = {
  analyzer: string;
  /**
   * The part after ' — ', when the row narrows the analyzer's hits.
   *
   * Two meanings behind one column, named rather than hidden behind a word that
   * claims only one of them: for `observedNetwork` it is a Finding.category
   * (`network_request` / `external_reference`); for `install` it is a
   * Finding.signal scope (`npx` / `not-npx`). Both are already on every Finding,
   * so neither needs a detector change.
   */
  scope: string | null;
  /** Which frozen corpus set the row was measured against. Absent cell => v1. */
  corpusSet: string;
  hits: number;
  rate: number;
  verdict: string;
};

/**
 * Parses fixtures/capability-precision.md's table. No Markdown library: the
 * table is this project's own fixed shape (`| Analyzer | Version | Corpus |
 * Hits | Hand-checked | FP | Rate | Verdict |`), and a real parser would cost
 * more than the eight columns it reads.
 */
function parseRecord(): Row[] {
  const text = readFileSync(RECORD_PATH, 'utf8');
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 8) continue;
    const [analyzerCell, , corpusCell, hitsCell, , , rateCell, verdictCell] = cells;
    if (analyzerCell === 'Analyzer' || /^-+$/.test(cells[0])) continue; // header / separator

    const [analyzerPart, scopePart] = analyzerCell.split('—').map((s) => s.trim());
    const hitsMatch = hitsCell.match(/^(\d+)/);
    const rateMatch = rateCell.match(/^(\d+(?:\.\d+)?)%/);
    if (!hitsMatch || !rateMatch) {
      throw new Error(`unparseable row in ${RECORD_PATH}: ${line}`);
    }
    // The Corpus cell leads with its set token, e.g. `v2 — 7 frozen corpora`.
    // Falling back to v1 rather than throwing keeps a row written before this
    // change resolving to the set it was actually measured against.
    const setMatch = corpusCell.match(/^(v\d+)\b/);
    const corpusSet = setMatch ? setMatch[1] : 'v1';
    if (!CORPUS_SETS[corpusSet]) {
      throw new Error(`unknown corpus set "${corpusSet}" in ${RECORD_PATH}: ${line}`);
    }
    rows.push({
      analyzer: analyzerPart.replace(/`/g, ''),
      scope: scopePart ? scopePart.replace(/`/g, '') : null,
      corpusSet,
      hits: Number(hitsMatch[1]),
      rate: Number(rateMatch[1]),
      verdict: verdictCell,
    });
  }
  return rows;
}

function corpusFiles(corpusSet: string): { sourcePath: string; raw: string }[] {
  const files: { sourcePath: string; raw: string }[] = [];
  for (const slug of CORPUS_SETS[corpusSet]) {
    const dir = join('fixtures', slug, 'files');
    for (const name of readdirSync(dir)) {
      files.push({
        sourcePath: decodeURIComponent(name),
        raw: readFileSync(join(dir, name), 'utf8'),
      });
    }
  }
  return files;
}

/**
 * Recomputes the live hit count for a row this test knows how to reproduce.
 * `html_comment_naive` has none — it was never shipped, so there is no
 * analyzer to re-run; its row is a permanent historical record, not a drift
 * target.
 */
function liveHits(row: Row): number | null {
  const files = corpusFiles(row.corpusSet);
  const bodyInput = (raw: string, sourcePath: string): AnalyzeInput => ({
    sourcePath,
    body: raw,
    frontmatter: {},
    meta: {},
    files: [],
  });

  if (row.analyzer === 'install') {
    // Scope is a Finding.signal here, not a category. No detector change is
    // needed for this: install.ts:44 already writes the matched literal as the
    // signal, so `npx` hits have always been distinguishable from the rest.
    // Same predicate scripts/capability-precision.mjs's --signal flag applies.
    const keep = (signal: string | undefined) => {
      if (row.scope === 'npx') return signal === 'npx';
      if (row.scope === 'not-npx') return signal !== 'npx';
      return true;
    };
    return files.reduce(
      (sum, f) =>
        sum + install(bodyInput(f.raw, f.sourcePath)).filter((x) => keep(x.signal)).length,
      0,
    );
  }
  if (row.analyzer === 'declaredCapabilities') {
    return files.reduce((sum, f) => {
      const parsed = parseFrontmatter(f.raw, f.sourcePath);
      const frontmatter = parsed.ok ? parsed.data : {};
      return sum + declaredCapabilities({ ...bodyInput('', f.sourcePath), frontmatter }).length;
    }, 0);
  }
  if (row.analyzer === 'observedNetwork') {
    return files.reduce((sum, f) => {
      const findings = observedNetwork(bodyInput(f.raw, f.sourcePath));
      return sum + findings.filter((finding) => finding.category === row.scope).length;
    }, 0);
  }
  if (row.analyzer === 'observedRemoteExecution') {
    return files.reduce(
      (sum, f) => sum + observedRemoteExecution(bodyInput(f.raw, f.sourcePath)).length,
      0,
    );
  }
  return null;
}

describe('CAP-13 — the precision record', () => {
  const rows = parseRecord();

  it('every registered analyzer has at least one row', () => {
    for (const analyzer of ANALYZERS) {
      const hasRow = rows.some((r) => r.analyzer === analyzer.name);
      expect(hasRow, `${analyzer.name} has no row in ${RECORD_PATH}`).toBe(true);
    }
  });

  it('every row whose analyzer this test can re-run has a hit count matching the live code', () => {
    for (const row of rows) {
      const live = liveHits(row);
      if (live === null) continue; // html_comment_naive: never shipped, nothing to re-run
      expect(
        live,
        `${row.analyzer}${row.scope ? ` (${row.scope})` : ''} [${row.corpusSet}] drifted from its recorded hit count`,
      ).toBe(row.hits);
    }
  });

  it('the kill line: a rate at or above 20% is deleted; a rate under 20% is not', () => {
    for (const row of rows) {
      const isDeleted = /deleted/i.test(row.verdict);
      if (row.rate >= KILL_LINE) {
        expect(isDeleted, `${row.analyzer} measures ${row.rate}% and must be marked deleted`).toBe(
          true,
        );
      } else {
        expect(
          isDeleted,
          `${row.analyzer} measures ${row.rate}%, under the kill line, and must not be marked deleted`,
        ).toBe(false);
      }
    }
  });
});
