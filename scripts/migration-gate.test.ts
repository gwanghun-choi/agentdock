import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import journal from '../drizzle/meta/_journal.json';
import {
  checkHistory,
  classifyMigration,
  planMigrations,
  productionTargetRejection,
  statementRisk,
  targetFingerprint,
} from './migration-gate.mjs';

const T = '"agentdock"."package"';
const risk = (sql: string) => statementRisk(sql, new Set());

describe('statementRisk — the additive allowlist', () => {
  it.each([
    `CREATE TABLE "agentdock"."x" ("id" serial PRIMARY KEY NOT NULL)`,
    `CREATE INDEX "i" ON ${T} USING btree ("name")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "i" ON ${T} ("name")`,
    `ALTER TABLE ${T} ADD COLUMN "note" text;`,
    `ALTER TABLE ${T} ADD COLUMN "files" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
    `ALTER TABLE ${T} ADD COLUMN "n" integer DEFAULT 0 NOT NULL`,
    `INSERT INTO "agentdock"."artifact_type" ("id", "label") VALUES ('agent', 'Subagent') ON CONFLICT DO NOTHING;`,
    `-- a comment only\n`,
  ])('applies unattended: %s', (sql) => {
    expect(risk(sql)).toBeNull();
  });

  it.each([
    [`ALTER TABLE ${T} DROP COLUMN "summary"`, 'not an additive shape'],
    [`DROP TABLE "agentdock"."package"`, 'not an additive shape'],
    [`TRUNCATE "agentdock"."package"`, 'not an additive shape'],
    [`DELETE FROM ${T} WHERE true`, 'not an additive shape'],
    [`UPDATE ${T} SET "summary" = null`, 'not an additive shape'],
    [`ALTER TABLE ${T} ALTER COLUMN "name" SET DATA TYPE varchar(10)`, 'not an additive shape'],
    [`ALTER TABLE ${T} ALTER COLUMN "summary" SET NOT NULL`, 'not an additive shape'],
    [`ALTER TABLE ${T} RENAME COLUMN "name" TO "title"`, 'not an additive shape'],
    [`ALTER TABLE ${T} ADD CONSTRAINT "u" UNIQUE ("name")`, 'not an additive shape'],
    [`ALTER TABLE ${T} ADD COLUMN "n" integer NOT NULL`, 'NOT NULL column without a default'],
    [`ALTER TABLE ${T} ADD COLUMN "at" timestamptz DEFAULT now()`, 'non-literal default'],
    [`ALTER TABLE ${T} ADD COLUMN "v" tsvector GENERATED ALWAYS AS (x) STORED`, 'generated column'],
    [`INSERT INTO ${T} ("name") VALUES ('x')`, 'not an additive shape'],
    [`DO $$ BEGIN PERFORM 1; END $$`, 'several statements'],
    // A file without breakpoints is one chunk; its first statement must not
    // vouch for the rest.
    [`CREATE TABLE "agentdock"."x" ("id" int); DROP TABLE ${T};`, 'several statements'],
  ])('needs approval: %s', (sql, reason) => {
    expect(risk(sql)).toContain(reason);
  });

  it('allows a foreign key only on a table the same migration creates', () => {
    const fk = `ALTER TABLE "agentdock"."x" ADD CONSTRAINT "x_fk" FOREIGN KEY ("p") REFERENCES ${T}("id")`;
    expect(statementRisk(fk, new Set(['agentdock.x']))).toBeNull();
    expect(statementRisk(fk, new Set())).toContain('not an additive shape');
    expect(
      classifyMigration([`CREATE TABLE "agentdock"."x" ("id" serial, "p" integer);`, fk]).approval,
    ).toEqual([]);
  });
});

describe('classifyMigration', () => {
  it('blocks what the boundary scanner refuses, whatever its shape', () => {
    expect(classifyMigration(['CREATE TABLE "public"."x" ("id" int)']).blocked).not.toEqual([]);
    expect(classifyMigration(['CREATE INDEX "i" ON package ("name")']).blocked).not.toEqual([]);
    expect(classifyMigration([`DROP TABLE ${T}`]).blocked[0]).toContain('review marker');
  });

  it('sends a reviewed destructive migration to approval, not to unattended apply', () => {
    const reviewed = classifyMigration([
      `-- agentdock:reviewed-destructive: column unused since 0099\nALTER TABLE ${T} DROP COLUMN "x"`,
    ]);
    expect(reviewed.blocked).toEqual([]);
    expect(reviewed.approval).toHaveLength(1);
  });

  it('classifies the shipped migrations as reviewed: 0006 and 0007 would need approval today', () => {
    const tags = new Map(journal.entries.map((e) => [e.when, e.tag]));
    const needs = readMigrationFiles({ migrationsFolder: './drizzle' })
      .filter((m) => classifyMigration(m.sql).approval.length > 0)
      .map((m) => tags.get(m.folderMillis));
    expect(needs).toEqual(['0006_silly_black_tom', '0007_green_jasper_sitwell']);
    for (const m of readMigrationFiles({ migrationsFolder: './drizzle' })) {
      expect(classifyMigration(m.sql).blocked).toEqual([]);
    }
  });
});

const disk = (millis: number, sql = [`CREATE INDEX "i${millis}" ON ${T} ("name")`]) => ({
  folderMillis: millis,
  hash: `h${millis}`,
  sql,
  bps: true,
});
const row = (millis: number, hash = `h${millis}`) => ({ hash, created_at: String(millis) });

describe('checkHistory', () => {
  it('returns the files newer than the newest applied one', () => {
    const r = checkHistory([row(1), row(2)], [disk(1), disk(2), disk(3)]);
    expect(r.problems).toEqual([]);
    expect(r.pending.map((m) => m.folderMillis)).toEqual([3]);
  });

  it('refuses a file edited after it was applied', () => {
    expect(checkHistory([row(1, 'old')], [disk(1)]).problems[0]).toContain('edited');
  });

  it('refuses a database that is ahead of the checkout (an older commit deployed)', () => {
    expect(checkHistory([row(1), row(9)], [disk(1)]).problems[0]).toContain('does not have');
  });

  it('refuses a gap that drizzle’s newest-created_at rule would skip forever', () => {
    const r = checkHistory([row(1), row(3)], [disk(1), disk(2), disk(3)]);
    expect(r.problems[0]).toContain('never applied');
  });
});

describe('planMigrations', () => {
  const tags = new Map([
    [1, '0001_a'],
    [2, '0002_b'],
    [3, '0003_drop'],
  ]);
  const drop = disk(3, [
    `-- agentdock:reviewed-destructive: test\nALTER TABLE ${T} DROP COLUMN "x"`,
  ]);

  it('is UP_TO_DATE with nothing pending and AUTO with additive files pending', () => {
    expect(
      planMigrations({ applied: [row(1), row(2)], onDisk: [disk(1), disk(2)], tags }).verdict,
    ).toBe('UP_TO_DATE');
    expect(planMigrations({ applied: [row(1)], onDisk: [disk(1), disk(2)], tags }).verdict).toBe(
      'AUTO',
    );
  });

  it('needs approval for a risky pending file, by its exact tag', () => {
    const base = { applied: [row(1), row(2)], onDisk: [disk(1), disk(2), drop], tags };
    expect(planMigrations(base).verdict).toBe('NEEDS_APPROVAL');
    expect(planMigrations({ ...base, approved: new Set(['0003_drop']) }).verdict).toBe('AUTO');
    expect(planMigrations({ ...base, approved: new Set(['0003']) }).verdict).toBe('BLOCKED');
  });

  it('refuses an approval that names nothing pending, so a stale one cannot carry over', () => {
    const p = planMigrations({
      applied: [row(1)],
      onDisk: [disk(1), disk(2)],
      tags,
      approved: new Set(['0003_drop']),
    });
    expect(p.verdict).toBe('BLOCKED');
  });

  it('skips the risk rule on a first bootstrap, but never in production', () => {
    const fresh = { applied: [], onDisk: [disk(1), drop], tags };
    expect(planMigrations(fresh).verdict).toBe('AUTO');
    expect(planMigrations({ ...fresh, production: true }).verdict).toBe('BLOCKED');
  });

  it('blocks on any history problem even with nothing risky pending', () => {
    expect(
      planMigrations({ applied: [row(1, 'x')], onDisk: [disk(1), disk(2)], tags }).verdict,
    ).toBe('BLOCKED');
  });
});

describe('production target', () => {
  const url =
    'postgresql://agentdock_app:s3cret@ep-x-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
  const pin = targetFingerprint(url);

  it('fingerprints the target, not the password or the query', () => {
    expect(pin).toMatch(/^[0-9a-f]{16}$/);
    expect(targetFingerprint(url.replace('s3cret', 'other').replace('?sslmode=require', ''))).toBe(
      pin,
    );
    expect(targetFingerprint(url.replace('ep-x-123', 'ep-y-456'))).not.toBe(pin);
    expect(targetFingerprint(url.replace('/neondb', '/other'))).not.toBe(pin);
  });

  it.each([
    [undefined, pin, 'not set'],
    ['mysql://a@b/c', pin, 'not a postgres'],
    ['postgres://agentdock_app@127.0.0.1:55432/agentdock_test', pin, 'this machine'],
    [url.replace('ep-x-123', 'ep-x-123-pooler'), pin, 'pooled'],
    [url, undefined, 'AGENTDOCK_TARGET_FINGERPRINT is not set'],
    [url.replace('ep-x-123', 'ep-y-456'), pin, 'does not match'],
  ])('refuses %s', (u, p, reason) => {
    expect(productionTargetRejection(u, p)).toContain(reason);
  });

  it('accepts the pinned target and never quotes it', () => {
    expect(productionTargetRejection(url, pin)).toBeNull();
    const mismatch = productionTargetRejection(url.replace('ep-x-123', 'ep-y-456'), pin) ?? '';
    expect(mismatch).not.toContain('neon.tech');
    expect(mismatch).not.toContain('s3cret');
  });
});
