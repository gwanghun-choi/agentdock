import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkMigrationSql,
  checkPackageScripts,
  checkSchemaModule,
  checkSourceBoundaries,
  sourceFiles,
} from './check-boundaries.mjs';

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

describe('checkSourceBoundaries', () => {
  it('accepts an ordinary source file', () => {
    expect(checkSourceBoundaries('src/db/queries/packages.ts', 'export const x = 1;')).toEqual([]);
  });

  it('reports a raw-HTML render path', () => {
    const viaPlugin = checkSourceBoundaries(
      'src/components/Body.tsx',
      "import rehypeRaw from 'rehype-raw';",
    );
    expect(viaPlugin.join(' ')).toMatch(/no-raw-html/);

    const viaReact = checkSourceBoundaries(
      'src/components/Body.tsx',
      'return <div dangerouslySetInnerHTML={{ __html: body }} />;',
    );
    expect(viaReact.join(' ')).toMatch(/no-raw-html/);
  });

  it('reports a subprocess or code-evaluation path', () => {
    const child = checkSourceBoundaries(
      'src/ingest/run.ts',
      "import { execSync } from 'node:child_process';",
    );
    expect(child.join(' ')).toMatch(/no-execution/);

    const vm = checkSourceBoundaries('src/ingest/run.ts', "import vm from 'node:vm';");
    expect(vm.join(' ')).toMatch(/no-execution/);
  });

  it('reports a disk write', () => {
    const problems = checkSourceBoundaries(
      'src/ingest/cache.ts',
      "writeFileSync('/tmp/body.md', body);",
    );
    expect(problems.join(' ')).toMatch(/no-disk-write/);
  });

  it('reports a GitHub hostname named outside the client directory', () => {
    const problems = checkSourceBoundaries(
      'src/ingest/fetch.ts',
      "await fetch('https://api.github.com/repos/o/r');",
    );
    expect(problems.join(' ')).toMatch(/no-host-sprawl/);
  });

  it('accepts the same hostname inside the GitHub client directory', () => {
    const problems = checkSourceBoundaries(
      'src/github/client.ts',
      "await fetch('https://api.github.com/repos/o/r');\n" +
        "await fetch('https://raw.githubusercontent.com/o/r/sha/p');",
    );
    expect(problems).toEqual([]);
  });

  it('still sees a host when the URL sits behind other code on the line', () => {
    // Regression: a naive line-comment strip treats the `//` in `https://` as a
    // comment start and deletes the hostname, making this rule match nothing.
    const problems = checkSourceBoundaries(
      'src/ingest/fetch.ts',
      'const base = "https://raw.githubusercontent.com"; const n = 1;',
    );
    expect(problems.join(' ')).toMatch(/no-host-sprawl/);
  });

  it('accepts a match that appears only inside a comment', () => {
    const source =
      '// raw.githubusercontent.com accepts both shas, so a raw-only check is not enough.\n' +
      '/* Never reach for dangerouslySetInnerHTML or execSync here. */\n' +
      'export const x = 1;';
    expect(checkSourceBoundaries('src/db/schema.ts', source)).toEqual([]);
  });

  it('accepts the schema module as committed, whose comment names a host', () => {
    const path = 'src/db/schema.ts';
    expect(checkSourceBoundaries(path, readFileSync(path, 'utf8'))).toEqual([]);
  });
});

describe('sourceFiles', () => {
  it('does not scan test files, which name hostile strings on purpose', () => {
    const walked = sourceFiles('src');
    expect(walked.length).toBeGreaterThan(0);
    expect(walked.filter((f) => f.includes('.test.'))).toEqual([]);
  });

  it('walks into subdirectories and keeps only source extensions', () => {
    const walked = sourceFiles('src').map((f) => f.split(sep).join('/'));
    expect(walked).toContain('src/db/queries/packages.ts');
    expect(walked.every((f) => /\.(ts|tsx|js|mjs)$/.test(f))).toBe(true);
  });
});
