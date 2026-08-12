import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Database-backed tests write, so they write to the test schema. The schema
// module reads this at import time, hence the assignment before any import of
// it. Vitest isolates files into separate workers, so this cannot leak.
process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

const REGISTRY_HOST = 'registry.modelcontextprotocol.io';

// The two GitHub repositories the fixtures name. Sentinels: the captured page's
// publisher names, versions, timestamps and envelope are real, but its
// repository URLs were rewritten to test-owner/corpus-spec-* because every
// DB-backed suite here shares one schema with every other, and a real
// repository name would collide with any suite that ingests it for real.
const TANDEM = 'test-owner/corpus-spec-tandem';
const AGENTBERG = 'test-owner/corpus-spec-agentberg';

/** The newest updatedAt in list-normal.json, and therefore the watermark an
 *  exhausted pass over it earns. */
const NEWEST_IN_NORMAL = '2026-06-18T01:49:38.050Z';

function fixture(name: string): string {
  return readFileSync(`fixtures/mcp-registry/list-${name}.json`, 'utf8');
}

/** A page built around the fixture's rows, with a cursor of our choosing. */
function pageWith(rows: unknown[], nextCursor: string | null): string {
  const metadata: Record<string, unknown> = { count: rows.length };
  // The absence of the key IS the end of pagination, so null must not appear.
  if (nextCursor !== null) metadata.nextCursor = nextCursor;
  return JSON.stringify({ servers: rows, metadata });
}

function normalRows(): unknown[] {
  return JSON.parse(fixture('normal')).servers;
}

/** The captured page carries a cursor, so it is a mid-sweep page by definition.
 *  This is the same rows as the last page of a pass. */
function normalExhausted(): string {
  return pageWith(normalRows(), null);
}

/** Every host the adapter contacted, and every URL. COR-01's "without consuming
 *  GitHub quota" is this array being exactly [the registry]. */
let hosts: string[] = [];
let urls: string[] = [];

function stubPages(...bodies: string[]) {
  hosts = [];
  urls = [];
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      urls.push(url.toString());
      const body = bodies[Math.min(call, bodies.length - 1)];
      call += 1;
      return new Response(body);
    }),
  );
}

function askedFor(index: number): URLSearchParams {
  return new URL(urls[index]).searchParams;
}

describe.skipIf(!DB_URL)('syncRegistry', () => {
  let syncRegistry: typeof import('./sync').syncRegistry;
  let REGISTRY_SOURCE: string;
  let syncState: typeof import('@/db/queries/syncState');
  let seeds: typeof import('@/db/queries/seeds');
  let sql: typeof import('@/db/client').sql;

  async function clean() {
    await sql`DELETE FROM repo_seed WHERE full_name LIKE 'test-owner/corpus-spec%'`;
    await sql`DELETE FROM schema_meta WHERE key = ${`corpus_sweep:${REGISTRY_SOURCE}`}`;
  }

  async function storedSeeds() {
    return sql<
      {
        full_name: string;
        discovered_from: string;
        discovered_path: string;
        hint: Record<string, unknown>;
      }[]
    >`
      SELECT full_name, discovered_from, discovered_path, hint
        FROM repo_seed
       WHERE full_name LIKE 'test-owner/corpus-spec%'
       ORDER BY full_name
    `;
  }

  const state = () => syncState.readSweepState(REGISTRY_SOURCE);

  beforeAll(async () => {
    ({ syncRegistry, REGISTRY_SOURCE } = await import('./sync'));
    syncState = await import('@/db/queries/syncState');
    seeds = await import('@/db/queries/seeds');
    ({ sql } = await import('@/db/client'));
    await clean();
  });

  afterAll(async () => {
    await clean();
    await sql.end();
  });

  beforeEach(clean);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('reading a page', () => {
    it('turns a normal page into one seed per GitHub-source row, lowercased', async () => {
      stubPages(fixture('normal'));

      const result = await syncRegistry({ maxPages: 1 });

      expect(result).toMatchObject({
        pagesRead: 1,
        pagesSanitized: 0,
        rowsSeen: 5,
        rowsInvalid: 0,
        // repository: {}, no repository key, and a gitlab URL. Not errors.
        rowsNoGithubRepo: 3,
        seedsUpserted: 2,
      });

      const rows = await storedSeeds();
      expect(rows.map((r) => r.full_name)).toEqual([AGENTBERG, TANDEM]);
      expect(rows.every((r) => r.discovered_from === 'mcp-registry')).toBe(true);
      // Provenance is the registry's own id, never a hostname (D-12).
      expect(rows.map((r) => r.discovered_path).sort()).toEqual([
        'ac.tandem/docs-mcp',
        'ai.agentberg/agentberg',
      ]);
    });

    it('contacts the registry and no other host, so the sweep spends no GitHub quota', async () => {
      stubPages(fixture('normal'));
      await syncRegistry({ maxPages: 1 });
      expect(hosts).toEqual([REGISTRY_HOST]);
      expect(hosts).not.toContain('api.github.com');
    });

    it('stores named hint fields only, never the publisher row verbatim', async () => {
      stubPages(fixture('normal'));
      await syncRegistry({ maxPages: 1 });

      const [agentberg] = await storedSeeds();
      expect(Object.keys(agentberg.hint).sort()).toEqual([
        'description',
        'registryName',
        'registryUpdatedAt',
        'version',
      ]);
      expect(agentberg.hint.registryUpdatedAt).toBe(NEWEST_IN_NORMAL);
    });

    it('reads an empty page as an exhausted pass, not as an error', async () => {
      stubPages(fixture('empty'));

      const result = await syncRegistry();
      expect(result).toMatchObject({
        rowsSeen: 0,
        seedsUpserted: 0,
        stoppedBecause: 'exhausted',
        stoppedAtCursor: null,
      });
    });

    it('skips every invalid row, counts them, and keeps the valid row from the same page', async () => {
      stubPages(fixture('malformed'));

      const result = await syncRegistry({ maxPages: 1 });
      expect(result).toMatchObject({ rowsSeen: 6, rowsInvalid: 5, seedsUpserted: 1 });
      expect((await storedSeeds()).map((r) => r.full_name)).toEqual([TANDEM]);
    });

    it('recovers a control-byte page, counts it as sanitized, and still reads its cursor', async () => {
      stubPages(fixture('control-byte'));

      const result = await syncRegistry({ maxPages: 1 });
      expect(result).toMatchObject({
        pagesRead: 1,
        pagesSanitized: 1,
        rowsSeen: 2,
        seedsUpserted: 2,
        stoppedAtCursor: 'ai.agentberg/agentberg:1.0.0',
      });
    });

    it('writes nothing new on a second pass over the same page', async () => {
      stubPages(fixture('normal'));
      await syncRegistry({ maxPages: 1 });
      const first = await storedSeeds();

      stubPages(fixture('normal'));
      await syncRegistry({ maxPages: 1 });
      const second = await storedSeeds();

      expect(second).toHaveLength(first.length);
      expect(second.map((r) => r.full_name)).toEqual(first.map((r) => r.full_name));
    });
  });

  describe('the bounded sweep', () => {
    it('walks pages until the cursor key stops appearing', async () => {
      const rows = normalRows();
      stubPages(pageWith(rows.slice(0, 2), 'c1'), pageWith(rows.slice(2), null));

      const result = await syncRegistry({ maxPages: 5 });

      expect(result).toMatchObject({ pagesRead: 2, rowsSeen: 5, stoppedBecause: 'exhausted' });
      expect(askedFor(0).has('cursor')).toBe(false);
      expect(askedFor(1).get('cursor')).toBe('c1');
    });

    it('stops at its page cap, stores the resume point, and reports it', async () => {
      stubPages(pageWith(normalRows().slice(0, 2), 'c1'));

      const result = await syncRegistry({ maxPages: 1 });

      expect(result).toMatchObject({ stoppedBecause: 'page_cap', stoppedAtCursor: 'c1' });
      expect((await state()).cursor).toBe('c1');
    });

    it('resumes the same pass from the stored cursor, under the same window', async () => {
      const rows = normalRows();
      stubPages(pageWith(rows.slice(0, 2), 'c1'));
      const first = await syncRegistry({ maxPages: 1 });
      const passStartedAt = first.passStartedAt;

      stubPages(pageWith(rows.slice(2), null));
      const second = await syncRegistry({ maxPages: 1 });

      expect(second.resumedFromCursor).toBe('c1');
      expect(askedFor(0).get('cursor')).toBe('c1');
      // The pass is one pass, spanning two invocations, so the window it earns
      // is measured from when the FIRST of them started.
      expect(second.passStartedAt).toBe(passStartedAt);
      expect(second.stoppedBecause).toBe('exhausted');
      // And the rows the capped run did not reach are reached now.
      expect((await storedSeeds()).map((r) => r.full_name)).toEqual([AGENTBERG, TANDEM]);
    });

    it('stops at its seed cap with the resume point stored, rather than truncating silently', async () => {
      const rows = normalRows();
      stubPages(pageWith(rows.slice(0, 2), 'c1'), pageWith(rows.slice(2), 'c2'));

      const result = await syncRegistry({ maxPages: 5, maxSeeds: 1 });

      expect(result).toMatchObject({ stoppedBecause: 'seed_cap', stoppedAtCursor: 'c1' });
      expect(result.seedsUpserted).toBeGreaterThanOrEqual(1);
      expect((await state()).cursor).toBe('c1');
    });

    it('stops on an unparseable page, keeping every seed the earlier pages produced', async () => {
      const rows = normalRows();
      stubPages(pageWith(rows, 'c1'), '{"servers": ');

      const result = await syncRegistry({ maxPages: 5 });

      expect(result).toMatchObject({
        pagesRead: 1,
        stoppedBecause: 'parse_failure',
        stoppedAtCursor: 'c1',
      });
      // Continuing past a page whose cursor could not be read would skip
      // everything after it, so the sweep stops — but what it already read stays.
      expect((await storedSeeds()).map((r) => r.full_name)).toEqual([AGENTBERG, TANDEM]);
      expect((await state()).cursor).toBe('c1');
    });
  });

  describe('the watermark', () => {
    it('passes nothing on a first pass, and walks from the start', async () => {
      stubPages(fixture('normal'));
      const result = await syncRegistry({ maxPages: 1 });

      expect(result.updatedSinceUsed).toBeNull();
      expect(askedFor(0).has('updated_since')).toBe(false);
    });

    it('advances only on an exhausted pass, and the next pass filters by it', async () => {
      stubPages(normalExhausted());
      const first = await syncRegistry();

      expect(first.stoppedBecause).toBe('exhausted');
      expect(first.watermarkAdvancedTo).toBe(NEWEST_IN_NORMAL);
      expect((await state()).watermark).toBe(NEWEST_IN_NORMAL);

      stubPages(fixture('empty'));
      const second = await syncRegistry();
      expect(second.updatedSinceUsed).toBe(NEWEST_IN_NORMAL);
      expect(askedFor(0).get('updated_since')).toBe(NEWEST_IN_NORMAL);
    });

    it('does NOT advance when the sweep stopped at its page cap', async () => {
      // The regression that matters, and the only thing holding the line: the
      // registry orders by server NAME and updated_since filters the whole name
      // space, so a watermark set from a prefix of the names hides every later
      // name whose last update predates it — from every future run, silently.
      // Nothing at runtime shows this. Only this test does.
      stubPages(pageWith(normalRows(), 'c1'));

      const result = await syncRegistry({ maxPages: 1 });

      expect(result.stoppedBecause).toBe('page_cap');
      expect(result.watermarkAdvancedTo).toBeNull();
      expect((await state()).watermark).toBeNull();

      // And the run after it still walks unfiltered, from the stored cursor.
      stubPages(pageWith([], 'c2'));
      await syncRegistry({ maxPages: 1 });
      expect(askedFor(0).has('updated_since')).toBe(false);
    });

    it('does not advance on a seed cap or on a parse failure either', async () => {
      const rows = normalRows();
      stubPages(pageWith(rows, 'c1'), pageWith(rows, 'c2'));
      await syncRegistry({ maxPages: 5, maxSeeds: 1 });
      expect((await state()).watermark).toBeNull();

      await clean();
      stubPages('{"servers": ');
      await syncRegistry({ maxPages: 5 });
      expect((await state()).watermark).toBeNull();
    });

    it('preserves an earlier watermark across a capped pass rather than clearing it', async () => {
      stubPages(normalExhausted());
      await syncRegistry();
      expect((await state()).watermark).toBe(NEWEST_IN_NORMAL);

      stubPages(pageWith(normalRows(), 'c1'));
      const capped = await syncRegistry({ maxPages: 1 });

      expect(capped.stoppedBecause).toBe('page_cap');
      expect((await state()).watermark).toBe(NEWEST_IN_NORMAL);
      expect((await state()).cursor).toBe('c1');
    });

    it('never claims a moment later than the pass began, whatever a publisher timestamps', async () => {
      // "Every name has been seen at least once as of this time" is true of the
      // start of a completed pass. A row updated mid-pass, after its own name
      // was already read, must not push the window past itself — and a clock
      // running ahead of the registry's must not either.
      const future = JSON.parse(fixture('normal'));
      future.servers[0]._meta['io.modelcontextprotocol.registry/official'].updatedAt =
        '2099-01-01T00:00:00.000Z';

      stubPages(JSON.stringify({ servers: future.servers, metadata: { count: 5 } }));
      const result = await syncRegistry();

      expect(result.watermarkAdvancedTo).toBe(result.passStartedAt);
      expect(Date.parse(result.watermarkAdvancedTo ?? '')).toBeLessThan(Date.parse('2099-01-01'));
    });
  });

  it('derives nothing from repo_seed: the watermark is sweep state, not row state', async () => {
    // newestRegistryUpdatedAt still reports what was stored, and it is
    // deliberately NOT what the sweep filters by — stored rows are a prefix of
    // the names, and that was the whole defect.
    stubPages(pageWith(normalRows(), 'c1'));
    await syncRegistry({ maxPages: 1 });

    expect(await seeds.newestRegistryUpdatedAt()).toBe(NEWEST_IN_NORMAL);
    expect((await state()).watermark).toBeNull();
  });
});
