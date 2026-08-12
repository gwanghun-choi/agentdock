import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeRepo } from '@/github/client';
import { loadSeedList, SEED_LIST_PATH, SEED_LIST_SOURCE, seedListRows } from './seedList';

/**
 * The committed file is the subject, not a fixture copy of it.
 *
 * A schema test over a synthetic document would pass on the day someone commits
 * a typo into config/seeds.json, which is the one failure this suite exists to
 * catch: that file is the only place in the project where a hand-typed string
 * becomes a URL AgentDock constructs.
 */
const FILE = loadSeedList();

/** Malformed documents, written to a temp dir rather than committed: each is one
 * line of JSON whose whole content is the thing being rejected. */
const TMP = mkdtempSync(join(tmpdir(), 'agentdock-seedlist-'));
function tempFile(name: string, body: string): string {
  const path = join(TMP, name);
  writeFileSync(path, body);
  return path;
}

describe('the committed operator seed list', () => {
  it('parses against the loader schema', () => {
    expect(FILE.seeds.length).toBeGreaterThan(0);
    expect(FILE.linkLists.length).toBeGreaterThan(0);
  });

  it('holds every fullName unchanged by normalizeRepo apart from case', () => {
    // A round trip, not a regex re-implementation: whatever normalizeRepo would
    // accept is what the ingest path accepts, and the two must not diverge.
    for (const entry of [...FILE.seeds, ...FILE.linkLists]) {
      const repo = normalizeRepo(entry.fullName);
      expect(repo, entry.fullName).not.toBeNull();
      expect(`${repo?.owner}/${repo?.repo}`.toLowerCase()).toBe(entry.fullName);
    }
  });

  it('names no repository twice, across seeds and link lists alike', () => {
    const names = [...FILE.seeds, ...FILE.linkLists].map((e) => e.fullName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every link list a path to read, so nothing has to be guessed', () => {
    for (const list of FILE.linkLists) expect(list.path.length).toBeGreaterThan(0);
  });
});

describe('seedListRows', () => {
  it('preserves the file order, which is measured artifact density order', () => {
    // The whole cold-start argument rests on this: two repositories carry more
    // artifacts than the other thirteen combined, so front-loading them is only
    // real if the order survives into insertion order and then into fan-out.
    expect(seedListRows(FILE).map((r) => r.fullName)).toEqual(FILE.seeds.map((s) => s.fullName));
  });

  it('tags every row with the operator provenance, distinguishable by query', () => {
    for (const row of seedListRows(FILE)) {
      expect(row.discoveredFrom).toBe(SEED_LIST_SOURCE);
      expect(row.discoveredPath).toBe(SEED_LIST_PATH);
      expect(row.sourceKind).toBe('github');
    }
  });

  it('names no hostname in its provenance (05-CONTEXT D-12)', () => {
    expect(SEED_LIST_SOURCE).not.toMatch(/\./);
  });

  it('carries each entry note into the hint, so the density claim travels with the row', () => {
    const rows = seedListRows(FILE);
    expect(rows[0].hint).toEqual({ note: FILE.seeds[0].note });
  });
});

describe('the rejected key', () => {
  it('produces no seed row — a rejected candidate cannot become live input', () => {
    // Six candidates were checked and found empty or absent. They stay in the
    // file so the next maintainer does not re-verify them, and the loader must
    // never spend two core requests re-learning what is already known.
    const rejected = (JSON.parse(JSON.stringify(FILE)) as { rejected?: unknown }).rejected;
    expect(rejected).toBeUndefined();

    const path = tempFile(
      'rejected-only.json',
      JSON.stringify({ seeds: [], rejected: [{ fullName: 'a/b', reason: 'gone' }] }),
    );
    expect(seedListRows(loadSeedList(path))).toEqual([]);
  });
});

describe('a file the loader refuses', () => {
  it('names the offending entry when a fullName is not an owner/repo', () => {
    const path = tempFile(
      'bad-entry.json',
      JSON.stringify({ seeds: [{ fullName: 'anthropics/skills' }, { fullName: 'not a repo' }] }),
    );
    expect(() => loadSeedList(path)).toThrow(/"not a repo"/);
  });

  it('refuses a fullName carrying a newline, before it can reach a URL', () => {
    const path = tempFile(
      'newline.json',
      JSON.stringify({ seeds: [{ fullName: 'a/b\nHost: x' }] }),
    );
    expect(() => loadSeedList(path)).toThrow(/is not an owner\/repo/);
  });

  it('reports which field is wrong when the shape is wrong', () => {
    const path = tempFile('bad-shape.json', JSON.stringify({ seeds: [{ note: 'no name' }] }));
    expect(() => loadSeedList(path)).toThrow(/seeds\.0\.fullName/);
  });

  it('says the file is not JSON rather than throwing a parser error', () => {
    const path = tempFile('not-json.json', '{ nope');
    expect(() => loadSeedList(path)).toThrow(/is not valid JSON/);
  });

  it('says the file could not be read when it is absent', () => {
    expect(() => loadSeedList(join(TMP, 'absent.json'))).toThrow(/could not be read/);
  });
});
