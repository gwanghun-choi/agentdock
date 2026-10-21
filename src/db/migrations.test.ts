import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

// Read-only: catalog queries, no table is written.
process.env.DATABASE_SCHEMA = 'agentdock_test';
const DB_URL = process.env.DATABASE_URL;

/**
 * The reviewed migrations in drizzle/ against the schema they claim to build.
 *
 * Two copies of the same structure live in the test database: `agentdock_test`
 * is DDL regenerated from src/db/schema.ts (`db:test:setup`), and `agentdock`
 * is drizzle/ applied file by file (`db:test:migrations`), exactly as a
 * deployment applies it. Every suite runs against the first; a deployment runs
 * the second. A hand-edited migration, a schema.ts change with no migration, or
 * a migration with no schema.ts change makes them differ — and before this
 * file nothing compared them.
 *
 * Skips when the second copy is absent (a local run that never ran
 * `db:test:migrations`), unless REQUIRE_TEST_DATABASE is set, as it is in CI.
 */
describe.skipIf(!DB_URL)('drizzle/ migrations match src/db/schema.ts', () => {
  const sql = postgres(DB_URL as string, { max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  const strip = (text: string | null, schema: string) =>
    (text ?? '').replaceAll(`"${schema}".`, '').replaceAll(`${schema}.`, '');

  async function shape(schema: string) {
    const columns = await sql<
      { t: string; c: string; type: string; nullable: string; d: string | null }[]
    >`
      select table_name as t, column_name as c, udt_name as type, is_nullable as nullable,
             column_default as d
        from information_schema.columns where table_schema = ${schema}
         and table_name <> '__drizzle_migrations'
       order by 1, 2`;
    const indexes = await sql<{ name: string; def: string }[]>`
      select indexname as name, indexdef as def from pg_indexes
       where schemaname = ${schema} and tablename <> '__drizzle_migrations' order by 1`;
    const constraints = await sql<{ t: string; name: string; def: string }[]>`
      select c.relname as t, k.conname as name, pg_get_constraintdef(k.oid) as def
        from pg_constraint k join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = ${schema} and c.relname <> '__drizzle_migrations' order by 1, 2`;
    return {
      columns: columns.map((r) => `${r.t}.${r.c} ${r.type} ${r.nullable} ${strip(r.d, schema)}`),
      indexes: indexes.map((r) => `${r.name}: ${strip(r.def, schema)}`),
      constraints: constraints.map((r) => `${r.t}.${r.name}: ${strip(r.def, schema)}`),
    };
  }

  it('builds the same tables, columns, indexes and constraints', async (ctx) => {
    const [applied] = await sql<{ present: boolean }[]>`
      select to_regclass('agentdock.__drizzle_migrations') is not null as present`;
    if (!applied.present) {
      if (process.env.REQUIRE_TEST_DATABASE) {
        throw new Error('agentdock holds no applied migrations: run `bun run db:test:migrations`.');
      }
      ctx.skip();
    }
    const migrated = await shape('agentdock');
    const declared = await shape('agentdock_test');
    expect(migrated.columns.length).toBeGreaterThan(0);
    expect(migrated.columns).toEqual(declared.columns);
    expect(migrated.indexes).toEqual(declared.indexes);
    expect(migrated.constraints).toEqual(declared.constraints);
  });
});
