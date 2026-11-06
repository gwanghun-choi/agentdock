import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;
const PREFIX = 'test-owner/home-snapshot';
const KEY = 'home:snapshot';

// The scripts run their work at import, so these read the source, the way
// src/instrumentation.test.ts does. The behaviour was run by hand against the test
// database (docs/analysis/phase93-artifacts/sync-flow.txt).
describe('who writes and removes the snapshot', () => {
  it('publishes only from a run with nothing failed, before it records success', () => {
    const source = readFileSync('scripts/corpus-sync.mjs', 'utf8');
    const guard = source.indexOf(
      "if (!failed && stageFailures.length === 0) {\n    await stage('home-snapshot'",
    );
    expect(guard).toBeGreaterThan(source.indexOf("sync.stoppedBecause === 'parse_failure'"));
    expect(guard).toBeGreaterThan(source.indexOf("await stage('drain'"));
    expect(guard).toBeLessThan(source.indexOf('await recordSyncSucceeded('));
  });

  it('is removed by a corpus reset, whose rows it would link to', () => {
    expect(readFileSync('scripts/corpus-reset.mjs', 'utf8')).toContain(`key = 'home:snapshot'`);
    expect(readFileSync('src/db/queries/homeSnapshot.ts', 'utf8')).toContain(
      `SNAPSHOT_KEY = 'home:snapshot'`,
    );
  });
});

describe.skipIf(!DB_URL)('the home snapshot', () => {
  let home: typeof import('./homeSnapshot');
  let packages: typeof import('./packages');
  let language: typeof import('./language');
  let sql: typeof import('@/db/client').sql;

  const live = async () => {
    const [recent, counts] = await Promise.all([
      packages.listPackages({
        limit: home.HOME_ROWS,
        hiddenLanguages: language.HIDDEN_UNLESS_ASKED,
      }),
      packages.countVisibleByType(language.HIDDEN_UNLESS_ASKED),
    ]);
    return { recent, ...counts };
  };
  const stored = async () =>
    (await sql<{ value: string }[]>`SELECT value FROM schema_meta WHERE key = ${KEY}`)[0]?.value;
  const store = (value: string, updatedAt = new Date()) =>
    sql`INSERT INTO schema_meta (key, value, updated_at) VALUES (${KEY}, ${value}, ${updatedAt.toISOString()}::timestamptz)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

  let seq = 0;
  async function artifact(summary: string, type = 'skill') {
    seq += 1;
    const [repo] = await sql<{ id: number }[]>`
      INSERT INTO repository (github_node_id, full_name, owner, default_branch, stars)
      VALUES (${`node-${PREFIX}-${seq}`}, ${`${PREFIX}-${seq}`}, 'test-owner', 'main', 1)
      RETURNING id`;
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO package (repository_id, type, source_path, name, slug, summary)
      VALUES (${repo.id}, ${type}, ${`p${seq}`}, ${`home-spec-${seq}`}, ${`p${seq}`}, ${summary})
      RETURNING id`;
    await sql`
      INSERT INTO package_version (package_id, commit_sha, content_hash, parse_status)
      VALUES (${row.id}, ${'c'.repeat(40)}, ${`home-spec-hash-${seq}`}, 'ok')`;
    return Number(row.id);
  }

  async function clean() {
    await sql`DELETE FROM schema_meta WHERE key = ${KEY}`;
    await sql`DELETE FROM package_version WHERE package_id IN (
      SELECT p.id FROM package p JOIN repository r ON r.id = p.repository_id
      WHERE r.full_name LIKE ${`${PREFIX}%`})`;
    await sql`DELETE FROM package WHERE repository_id IN (
      SELECT id FROM repository WHERE full_name LIKE ${`${PREFIX}%`})`;
    await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}%`}`;
  }

  beforeAll(async () => {
    home = await import('./homeSnapshot');
    packages = await import('./packages');
    language = await import('./language');
    ({ sql } = await import('@/db/client'));
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await sql.end();
  });

  it('reads back exactly what the live queries return', async () => {
    await artifact('An English description of a skill.');
    await artifact('一个用中文写的技能说明，内容足够长以便判断语言。');
    await artifact('A hook description.', 'hook');
    const expected = await live();
    expect(expected.hidden).toBeGreaterThanOrEqual(1);

    expect((await home.publishHomeSnapshot()).written).toBe(true);
    const log = vi.spyOn(console, 'log');
    const { lastSync: _, ...read } = await home.readHomeData();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
    // Whole rows, dates as dates: the feed formats scannedAt with toISOString.
    expect(read).toEqual(expected);
  });

  it('keeps serving the published result while the corpus moves on', async () => {
    await home.publishHomeSnapshot();
    const before = await home.readHomeData();
    await artifact('Added after the snapshot.');
    expect((await home.readHomeData()).recent).toEqual(before.recent);
    expect((await live()).recent).not.toEqual(before.recent);
  });

  it.each([
    ['missing', null],
    ['unreadable', 'not json'],
    ['unreadable', JSON.stringify({ version: 2 })],
    ['unreadable', JSON.stringify({ version: 1, generatedAt: new Date(), recent: 'x' })],
  ])('reads live and says so when the snapshot is %s (%s)', async (fallback, value) => {
    await artifact('Listed live.');
    if (value !== null) await store(value);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { lastSync: _, ...read } = await home.readHomeData();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      event: 'home_snapshot',
      fallback,
    });
    log.mockRestore();
    expect(read).toEqual(await live());
  });

  it('stops trusting a snapshot past its age, and not before', async () => {
    await artifact('Before.');
    await home.publishHomeSnapshot();
    const snapshot = JSON.parse((await stored()) as string);
    const aged = (ms: number) =>
      store(JSON.stringify({ ...snapshot, generatedAt: new Date(Date.now() - ms).toISOString() }));
    await artifact('After.');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await aged(home.SNAPSHOT_MAX_AGE_MS - 60_000);
    expect((await home.readHomeData()).recent).toHaveLength(snapshot.recent.length);
    expect(log).not.toHaveBeenCalled();

    await aged(home.SNAPSHOT_MAX_AGE_MS + 60_000);
    const { lastSync: _, ...read } = await home.readHomeData();
    expect(read).toEqual(await live());
    expect(JSON.parse(String(log.mock.calls[0]?.[0])).fallback).toBe('stale');
    log.mockRestore();
  });

  it('reads the feed and the counts from one state of the corpus', async () => {
    await artifact('Before the read.');
    const { db } = await import('@/db/client');
    const transaction = db.transaction.bind(db);
    let late = 0;
    // A row committed by another connection after the transaction's first statement
    // and before its two reads. Reads outside the transaction, or under read
    // committed, would both see it.
    const spy = vi.spyOn(db, 'transaction').mockImplementation(((
      run: (tx: unknown) => unknown,
      config: never,
    ) =>
      transaction(
        ((tx: typeof db) =>
          run(
            new Proxy(tx, {
              get: (target, key) =>
                key === 'execute'
                  ? async (query: never) => {
                      const result = await target.execute(query);
                      late = await artifact('Committed during the read.');
                      return result;
                    }
                  : Reflect.get(target, key),
            }),
          )) as never,
        config,
      )) as never);
    await home.publishHomeSnapshot();
    spy.mockRestore();
    expect(late).toBeGreaterThan(0);
    const snapshot = JSON.parse((await stored()) as string);
    expect(snapshot.recent.map((r: { id: number }) => r.id)).not.toContain(late);
    expect((await live()).recent.map((r) => r.id)).toContain(late);
  });

  it('reports the last good sync on both paths, and no date for an unreadable one', async () => {
    const before = (
      await sql<{ value: string }[]>`SELECT value FROM schema_meta WHERE key = 'sync:last_success'`
    )[0]?.value;
    const write = (value: string) =>
      sql`INSERT INTO schema_meta (key, value) VALUES ('sync:last_success', ${value})
          ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await write('2026-11-06T06:30:00.000Z');
      expect((await home.readHomeData()).lastSync?.toISOString()).toBe('2026-11-06T06:30:00.000Z');
      await home.publishHomeSnapshot();
      expect((await home.readHomeData()).lastSync?.toISOString()).toBe('2026-11-06T06:30:00.000Z');
      await write('not a date');
      expect((await home.readHomeData()).lastSync).toBeNull();
    } finally {
      log.mockRestore();
      if (before === undefined) await sql`DELETE FROM schema_meta WHERE key = 'sync:last_success'`;
      else await write(before);
    }
  });

  it('refuses to publish what it could not read back', async () => {
    const packageColumn = { ...(await live()).recent[0], addedColumn: 1 };
    await artifact('Listed.');
    await home.publishHomeSnapshot();
    const before = await stored();
    const { db } = await import('@/db/client');
    const spy = vi.spyOn(db, 'transaction').mockResolvedValueOnce({
      version: 1,
      generatedAt: new Date().toISOString(),
      recent: [{ ...packageColumn, id: 1 }],
      visible: {},
      hidden: 0,
    } as never);
    await expect(home.publishHomeSnapshot()).rejects.toThrow();
    spy.mockRestore();
    expect(await stored()).toBe(before);
  });

  it('drops a row delisted since the snapshot, and keeps the counts as published', async () => {
    const gone = await artifact('Delisted by a later run.');
    await home.publishHomeSnapshot();
    const before = await home.readHomeData();
    expect(before.recent.map((r) => r.id)).toContain(gone);
    await sql`UPDATE package SET delisted_at = now() WHERE id = ${gone}`;
    const after = await home.readHomeData();
    expect(after.recent.map((r) => r.id)).not.toContain(gone);
    expect(after.visible).toEqual(before.visible);
  });

  it('does not let an older read replace a newer one', async () => {
    await store('newer', new Date(Date.now() + 60_000));
    expect((await home.publishHomeSnapshot()).written).toBe(false);
    expect(await stored()).toBe('newer');
  });

  it('survives overlapping publishers and ends on a complete result', async () => {
    await artifact('Concurrent.');
    const expected = await live();
    const results = await Promise.all(Array.from({ length: 5 }, () => home.publishHomeSnapshot()));
    expect(results.some((r) => r.written)).toBe(true);
    const { lastSync: _, ...read } = await home.readHomeData();
    expect(read).toEqual(expected);
  });

  it('leaves the stored snapshot alone when the read fails', async () => {
    await home.publishHomeSnapshot();
    const before = await stored();
    const { db } = await import('@/db/client');
    const spy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('read failed'));
    await expect(home.publishHomeSnapshot()).rejects.toThrow('read failed');
    spy.mockRestore();
    expect(await stored()).toBe(before);
  });
});
