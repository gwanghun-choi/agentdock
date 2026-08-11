import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETECTORS } from './index';
import { collectCandidates, orderedNeeds, safeParse } from './run';
import type { Candidate, Detector, TreeEntry } from './types';

function detectorThatThrowsOnMatch(type: string): Detector {
  return {
    type,
    match(): Candidate[] {
      throw new Error(`${type} match blew up`);
    },
    async parse() {
      throw new Error('unreachable: match already threw');
    },
  };
}

function detectorThatThrowsOnParse(type: string, needs: string[]): Detector {
  return {
    type,
    match(): Candidate[] {
      return [{ type, sourcePath: needs[0], needs }];
    },
    async parse(): Promise<never> {
      throw new Error(`${type} parse blew up`);
    },
  };
}

function fineDetector(type: string, needs: string[]): Detector {
  return {
    type,
    match(): Candidate[] {
      return [{ type, sourcePath: needs[0], needs }];
    },
    async parse(c: Candidate) {
      return {
        ok: true,
        status: 'ok',
        warnings: [],
        artifact: {
          name: c.sourcePath,
          slug: c.sourcePath,
          summary: null,
          licenseText: null,
          declaredVersion: null,
          body: '',
          frontmatter: {},
          meta: {},
        },
      };
    },
  };
}

const TREE: TreeEntry[] = [{ path: 'a.txt', type: 'blob', sha: 'x' }];

describe('collectCandidates', () => {
  it('costs a throwing detector only its own candidates, leaving every other detector unaffected', () => {
    const boom = detectorThatThrowsOnMatch('boom');
    const fine = fineDetector('fine', ['fine.txt']);

    const passes = collectCandidates([boom, fine], TREE);

    expect(passes).toHaveLength(2);
    const boomPass = passes.find((p) => p.detector === boom);
    const finePass = passes.find((p) => p.detector === fine);
    expect(boomPass?.candidates).toEqual([]);
    expect(boomPass?.error).toContain('boom match blew up');
    expect(finePass?.candidates).toHaveLength(1);
    expect(finePass?.error).toBeNull();
  });

  it('returns one empty pass per detector and does not throw when every detector throws', () => {
    const passes = collectCandidates(
      [detectorThatThrowsOnMatch('a'), detectorThatThrowsOnMatch('b')],
      TREE,
    );
    expect(passes).toHaveLength(2);
    expect(passes.every((p) => p.candidates.length === 0)).toBe(true);
    expect(passes.every((p) => p.error !== null)).toBe(true);
  });
});

describe('orderedNeeds', () => {
  it('interleaves round robin across detectors so a cap cannot starve the last one', () => {
    const a: Detector = {
      type: 'a',
      match: () => [
        { type: 'a', sourcePath: 'a1', needs: ['a1'] },
        { type: 'a', sourcePath: 'a2', needs: ['a2'] },
        { type: 'a', sourcePath: 'a3', needs: ['a3'] },
      ],
      parse: async () => {
        throw new Error('unused');
      },
    };
    const b: Detector = {
      type: 'b',
      match: () => [{ type: 'b', sourcePath: 'b1', needs: ['b1'] }],
      parse: async () => {
        throw new Error('unused');
      },
    };

    const passes = collectCandidates([a, b], TREE);
    expect(orderedNeeds(passes)).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('is empty over an empty pass list, so a repository with no artifacts reads zero files', () => {
    expect(orderedNeeds([])).toEqual([]);
    expect(orderedNeeds(collectCandidates([], TREE))).toEqual([]);
  });
});

describe('safeParse', () => {
  it('returns a failed ParseResult naming the detector when parse() throws, rather than throwing', async () => {
    const boom = detectorThatThrowsOnParse('boom', ['boom.txt']);
    const candidate: Candidate = { type: 'boom', sourcePath: 'boom.txt', needs: ['boom.txt'] };

    const result = await safeParse(boom, candidate, async () => 'source');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toContain('boom detector threw');
    expect(result.ok === false && result.errors[0]).toContain('boom parse blew up');
  });

  it('passes through a successful parse unchanged', async () => {
    const fine = fineDetector('fine', ['fine.txt']);
    const candidate: Candidate = { type: 'fine', sourcePath: 'fine.txt', needs: ['fine.txt'] };

    const result = await safeParse(fine, candidate, async () => 'source');

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.status).toBe('ok');
  });
});

/**
 * DET-09, as an assertion rather than a review note.
 *
 * `seventh` exists only inside this file. It is never imported by src/, never
 * added to DETECTORS, and nothing in the pipeline knows its type — which is
 * the point: registering a seventh artifact type is one new file and one new
 * element in the DETECTORS array, and everything between match() and a parsed
 * artifact already accepts it, because collectCandidates and safeParse take
 * the detector list as a parameter rather than importing DETECTORS.
 *
 * What this does NOT prove: persistence. A package row needs an artifact_type
 * row and therefore a migration, which is a schema change and was never
 * claimed to be free. The promise is about the detector contract — match(),
 * collectCandidates, safeParse, and the ParseResult envelope — and that is
 * what is asserted below.
 */
const seventh: Detector = {
  type: 'invented',
  match(tree: TreeEntry[]): Candidate[] {
    return tree
      .filter((e) => e.type === 'blob' && e.path === 'INVENTED.marker')
      .map((e) => ({ type: 'invented', sourcePath: e.path, needs: [e.path] }));
  },
  async parse(c: Candidate, read: (path: string) => Promise<string>) {
    const source = await read(c.sourcePath);
    return {
      ok: true,
      status: 'ok' as const,
      warnings: [],
      artifact: {
        name: source.trim(),
        slug: source.trim(),
        summary: null,
        licenseText: null,
        declaredVersion: null,
        body: source,
        frontmatter: {},
        meta: {},
      },
    };
  },
};

describe('DET-09 — a seventh detector, defined only inside this test', () => {
  const tree: TreeEntry[] = [
    { path: 'SKILL.md', type: 'blob', sha: 'a' },
    { path: 'INVENTED.marker', type: 'blob', sha: 'b' },
  ];
  const read = async (path: string) =>
    path === 'INVENTED.marker'
      ? 'invented-artifact'
      : '---\nname: x\ndescription: d\n---\n\nBody.\n';

  it('runs a detector that the registry has never seen, through the same code the pipeline runs', async () => {
    const passes = collectCandidates([...DETECTORS, seventh], tree);

    expect(passes).toHaveLength(DETECTORS.length + 1);
    const seventhPass = passes.at(-1);
    if (!seventhPass) throw new Error('unreachable: passes is non-empty');
    expect(seventhPass.detector).toBe(seventh);
    expect(seventhPass.candidates).toHaveLength(1);

    const result = await safeParse(seventh, seventhPass.candidates[0], read);
    expect(result.ok).toBe(true);
    expect(result.ok && result.status === 'ok' && result.artifact.name).toBe('invented-artifact');
  });

  it("leaves the six real detectors' output identical whether or not it is present", () => {
    const without = collectCandidates(DETECTORS, tree);
    const withSeventh = collectCandidates([...DETECTORS, seventh], tree);

    expect(withSeventh.slice(0, DETECTORS.length).map((p) => p.candidates.length)).toEqual(
      without.map((p) => p.candidates.length),
    );
    expect(withSeventh.slice(0, DETECTORS.length).map((p) => p.detector)).toEqual(
      without.map((p) => p.detector),
    );
  });
});

describe('DET-10 — every detector runs against frozen fixtures, no network, no token', () => {
  it("every registered detector's match takes exactly one parameter, so none of them can fetch", () => {
    for (const d of DETECTORS) expect(d.match).toHaveLength(1);
  });

  describe('all six detectors over all four frozen corpora, fetch stubbed to throw', () => {
    const CORPORA = [
      'anthropics-skills',
      'addyosmani-agent-skills',
      'baoyu-skills',
      'wshobson-agents',
    ];

    beforeEach(() => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('a detector reached the network — DET-10 violated');
        }),
      );
      vi.stubEnv('GITHUB_TOKEN', '');
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('completes and produces artifacts, contacting neither fetch nor GITHUB_TOKEN', async () => {
      let artifactCount = 0;

      for (const slug of CORPORA) {
        const dir = join('fixtures', slug);
        const corpusTree: TreeEntry[] = JSON.parse(
          readFileSync(join(dir, 'tree.json'), 'utf8'),
        ).tree;
        const files = new Map<string, string>();
        for (const name of readdirSync(join(dir, 'files'))) {
          files.set(decodeURIComponent(name), readFileSync(join(dir, 'files', name), 'utf8'));
        }
        const read = async (path: string) => {
          const body = files.get(path);
          if (body === undefined) throw new Error(`no captured body for ${path}`);
          return body;
        };

        // match() cannot throw due to a stubbed fetch — it is pure and
        // path-only, so this line alone is most of DET-10's structural proof.
        const passes = collectCandidates(DETECTORS, corpusTree);
        for (const pass of passes) expect(pass.error).toBeNull();

        for (const pass of passes) {
          for (const candidate of pass.candidates) {
            const result = await safeParse(pass.detector, candidate, read);
            // A candidate whose body was never captured to disk (only
            // SKILL.md bodies were pinned by capture-fixtures.mjs) fails
            // cleanly via the "could not read" branch — never by reaching for
            // a network. Either way, safeParse returns rather than throwing.
            if (result.ok && (result.status === 'ok' || result.status === 'partial')) {
              artifactCount += 1;
            }
          }
        }
      }

      // Every one of the 18 anthropics-skills bodies was captured, so this
      // run alone guarantees a non-zero count regardless of which other
      // corpora's bodies were pinned.
      expect(artifactCount).toBeGreaterThan(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
