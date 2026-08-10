import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMigrationSql, checkPackageScripts, checkSchemaModule } from './check-boundaries.mjs';

const GOOD = `
CREATE TABLE "agentdock"."schema_meta" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL
);
CREATE INDEX "schema_meta_value_idx" ON "agentdock"."schema_meta" ("value");
`;

describe('checkMigrationSql', () => {
  it('accepts a fully qualified migration inside the owned schema', () => {
    expect(checkMigrationSql(GOOD)).toEqual([]);
  });

  it('rejects a statement naming a schema AgentDock does not own', () => {
    const problems = checkMigrationSql('CREATE TABLE "didim_mcp"."mcp_tools" ("id" int);');
    expect(problems.join(' ')).toMatch(/does not own/);
  });

  it('rejects a schema-qualified reference to public', () => {
    const problems = checkMigrationSql('ALTER TABLE "public"."users" ADD COLUMN "x" int;');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('rejects an unqualified target', () => {
    const problems = checkMigrationSql('CREATE TABLE "packages" ("id" int);');
    expect(problems.join(' ')).toMatch(/not schema-qualified/);
  });

  it('rejects an unqualified index target', () => {
    const problems = checkMigrationSql('CREATE INDEX "i" ON "packages" ("id");');
    expect(problems.join(' ')).toMatch(/not schema-qualified/);
  });

  it('rejects a destructive verb with no review marker', () => {
    const problems = checkMigrationSql('DROP TABLE "agentdock"."schema_meta";');
    expect(problems.join(' ')).toMatch(/review marker/);
  });

  it('accepts a destructive verb that carries a review marker', () => {
    const sql =
      '-- agentdock:reviewed-destructive: column replaced in the same migration\n' +
      'ALTER TABLE "agentdock"."schema_meta" DROP COLUMN "value";';
    expect(checkMigrationSql(sql)).toEqual([]);
  });

  it('does not let a comment smuggle in a forbidden schema name', () => {
    expect(checkMigrationSql(`-- unrelated note about public.foo\n${GOOD}`)).toEqual([]);
  });

  it('rejects CREATE SCHEMA, which the application role cannot execute', () => {
    const problems = checkMigrationSql(`CREATE SCHEMA "agentdock";\n${GOOD}`);
    expect(problems.join(' ')).toMatch(/review marker/);
  });
});

describe('checkPackageScripts', () => {
  it('accepts this repository as committed', () => {
    expect(checkPackageScripts(readFileSync('package.json', 'utf8'))).toEqual([]);
  });

  it('rejects a script that diffs live database state', () => {
    const problems = checkPackageScripts('{"scripts":{"sync":"drizzle-kit push"}}');
    expect(problems.length).toBe(1);
  });

  it('rejects a banned script name even with a harmless body', () => {
    const problems = checkPackageScripts('{"scripts":{"db:push":"echo no"}}');
    expect(problems.length).toBe(1);
  });
});

describe('checkSchemaModule', () => {
  it('rejects a module with no pgSchema call', () => {
    const problems = checkSchemaModule("export const t = pgTable('x', {});");
    expect(problems.length).toBe(2);
  });

  it('accepts a module where every table hangs off pgSchema', () => {
    const source =
      "export const agentdock = pgSchema('agentdock');\n" +
      "export const meta = agentdock.table('schema_meta', {});";
    expect(checkSchemaModule(source)).toEqual([]);
  });
});
