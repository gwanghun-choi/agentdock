import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORPUS_CAPS } from './caps';
import { expandLinkLists, extractRepoLinks } from './links';

/**
 * The committed hostile input is the regression; this file is the assertion.
 * fixtures/adversarial/README.md's own rule, and the reason every link shape
 * lives in the fixture rather than in a string literal here.
 */
const LIST = readFileSync(join('fixtures', 'adversarial', 'awesome-list.md'), 'utf8');

const OWNER = 'link-spec-owner';

describe('extractRepoLinks over the committed awesome-list fixture', () => {
  const { repos, overflow } = extractRepoLinks(LIST);

  it('returns every repository it names, lowercased and de-duplicated', () => {
    expect(repos).toEqual([
      `${OWNER}/shape-a`,
      `${OWNER}/shape-b`,
      `${OWNER}/shape-c`,
      `${OWNER}/alpha`,
      `${OWNER}/beta`,
      `${OWNER}/gamma`,
    ]);
    expect(overflow).toBe(0);
  });

  it('reads a parenthesised, an angle-bracketed and a bare link as one repository', () => {
    // The fixture names shape-a three ways. Three shapes, one row.
    expect(repos.filter((r) => r === `${OWNER}/shape-a`)).toHaveLength(1);
  });

  it('collapses a deep link, a tree link and a clone URL onto the repository root', () => {
    expect(repos).toContain(`${OWNER}/shape-b`);
    expect(repos.some((r) => r.includes('blob') || r.endsWith('.git'))).toBe(false);
  });

  it('yields nothing for a github.com path that is a site route, not a repository', () => {
    // A topic page and an organisation tab are both well-formed owner/repo
    // strings, so without the reserved-segment guard each becomes a seed and
    // then two core requests spent learning it is a 404.
    for (const route of ['orgs/', 'topics/', 'sponsors/', 'users/']) {
      expect(repos.some((r) => r.startsWith(route))).toBe(false);
    }
  });

  it('yields nothing for a user page, a gist, or the raw host', () => {
    expect(repos).not.toContain(OWNER);
    expect(repos.some((r) => r.includes('gist'))).toBe(false);
    expect(repos).not.toContain(`${OWNER}/alpha/main`);
  });

  it('yields nothing for another host, a lookalike host, or a userinfo prefix', () => {
    // github.com.evil.example and github.com@evil.example both resolve to
    // evil.example, and githubRepoFromUrl is the single place that decides so.
    expect(repos).not.toContain(`${OWNER}/not-github`);
    expect(repos).not.toContain(`${OWNER}/spoofed`);
  });

  it('matches no plain-HTTP link at all, because the pattern requires https', () => {
    expect(repos).not.toContain(`${OWNER}/insecure`);
  });

  it('throws on none of the malformed tokens the fixture ends with', () => {
    expect(() => extractRepoLinks(LIST)).not.toThrow();
    expect(repos).not.toContain(`${OWNER}/spaced`);
  });
});

describe('the cap on one list', () => {
  it("returns the cap's worth and reports the overflow as a number", () => {
    const over = 25;
    const markdown = Array.from(
      { length: CORPUS_CAPS.maxLinksPerList + over },
      (_, i) => `- [x](https://github.com/${OWNER}/repo-${i})`,
    ).join('\n');

    const result = extractRepoLinks(markdown);
    expect(result.repos).toHaveLength(CORPUS_CAPS.maxLinksPerList);
    expect(result.overflow).toBe(over);
  });
});

/**
 * A generous smoke alarm for a super-linear regression, not a performance
 * budget — src/analyze/redos.test.ts's shape, for the same reason it is generous
 * there: a tight bound turns a correctness gate into a flake on a loaded runner.
 */
const WALL_CLOCK_BOUND_MS = 500;

describe('a pathological input', () => {
  it('completes well under a second over many thousands of near-URL tokens', () => {
    // Generated rather than committed: unlike redos-line.md's hand-tuned byte
    // sequence, this input is one repeated token and writing a megabyte of it
    // into the repository would buy nothing the .repeat() does not say.
    const body = [
      'https://'.repeat(20_000),
      `https://${'a'.repeat(400)}`.repeat(2_000),
      'https://github.com/'.repeat(20_000),
      `https://github.com/${OWNER}/${'b'.repeat(500)}`.repeat(2_000),
    ].join('\n');

    const start = performance.now();
    const result = extractRepoLinks(body);
    expect(performance.now() - start).toBeLessThan(WALL_CLOCK_BOUND_MS);
    // The 500-character repo segment is past normalizeRepo's 100-character cap,
    // so the whole pathological body yields nothing.
    expect(result.repos).toEqual([]);
  });
});

describe('expandLinkLists', () => {
  /** Every hostname the run was asked for. The claim this suite exists to make. */
  let contacted: string[] = [];

  beforeEach(() => {
    contacted = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        contacted.push(url.hostname);
        return new Response(LIST, { status: 200 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const spec = { fullName: `${OWNER}/awesome`, path: 'README.md' };

  it('reads each list from the raw host and nowhere else', async () => {
    await expandLinkLists([spec]);
    // Not api.github.com, and above all not any address the list itself named:
    // an extracted URL becomes an owner/repo and is never a fetch target.
    expect([...new Set(contacted)]).toEqual(['raw.githubusercontent.com']);
  });

  it('spends no request on anything it extracted', async () => {
    const result = await expandLinkLists([spec]);
    expect(result.rows.length).toBeGreaterThan(0);
    // One list, one read. Six repositories came out of it and none was fetched.
    expect(contacted).toHaveLength(1);
  });

  it('records the unpinned read in the row rather than in a footnote', async () => {
    const { rows } = await expandLinkLists([spec]);
    for (const row of rows) {
      expect(row.discoveredPath).toBe('README.md@HEAD');
      expect(row.discoveredFrom).toBe(`${OWNER}/awesome`);
      expect(row.sourceKind).toBe('github');
    }
  });

  it('names the list by owner/repo, never by a hostname (D-12)', async () => {
    const { rows } = await expandLinkLists([spec]);
    for (const row of rows) expect(row.discoveredFrom).not.toMatch(/\./);
  });

  it('asks the capped reader for at most maxLinkListBytes', async () => {
    // The cap is enforced by cancelling the stream, so a file larger than it is
    // refused rather than read whole and measured afterwards.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const oversized = 'x'.repeat(CORPUS_CAPS.maxLinkListBytes + 1024);
        return new Response(oversized, { status: 200 });
      }),
    );
    const result = await expandLinkLists([spec]);
    expect(result).toMatchObject({ listsRead: 0, listsFailed: 1 });
    expect(result.rows).toEqual([]);
  });

  it('counts a list it cannot read and still reads the next one', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1 ? new Response('nope', { status: 404 }) : new Response(LIST);
      }),
    );

    const result = await expandLinkLists([{ fullName: `${OWNER}/gone`, path: 'README.md' }, spec]);
    expect(result).toMatchObject({ listsRead: 1, listsFailed: 1 });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('refuses a list whose own name is not an owner/repo, without a request', async () => {
    const result = await expandLinkLists([{ fullName: 'not a repo', path: 'README.md' }]);
    expect(result).toMatchObject({ listsRead: 0, listsFailed: 1 });
    expect(contacted).toEqual([]);
  });

  it('does not seed the list with itself', async () => {
    const result = await expandLinkLists([{ fullName: `${OWNER}/shape-a`, path: 'README.md' }]);
    expect(result.rows.map((r) => r.fullName)).not.toContain(`${OWNER}/shape-a`);
  });
});
