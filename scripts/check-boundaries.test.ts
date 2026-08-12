import { readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_HOSTS as githubAllowedHosts } from '@/github/client';
import { ALLOWED_HOSTS as registryAllowedHosts } from '@/registry/client';
import {
  checkMigrationSql,
  checkPackageScripts,
  checkSchemaModule,
  checkSourceBoundaries,
  checkVerdictVocabulary,
  HOST_RULES,
  SANCTIONED,
  sourceFiles,
  verdictVocabularyFiles,
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
    const problems = checkMigrationSql('CREATE TABLE "other_app"."their_table" ("id" int);');
    expect(problems.join(' ')).toMatch(/does not own/);
  });

  it('rejects a schema-qualified reference to public', () => {
    const problems = checkMigrationSql('ALTER TABLE "public"."users" ADD COLUMN "x" int;');
    expect(problems.length).toBeGreaterThan(0);
  });

  it('allows referencing a shared extension operator class in public', () => {
    const problems = checkMigrationSql(
      `CREATE INDEX "package_fuzzy_trgm_idx" ON "agentdock"."package" USING gin (("name") public.gin_trgm_ops);`,
    );
    expect(problems).toEqual([]);
  });

  it('still rejects a public table reference alongside the operator-class exemption', () => {
    const problems = checkMigrationSql(
      `CREATE INDEX "i" ON "agentdock"."package" USING gin (("name") public.gin_trgm_ops);\nALTER TABLE "public"."users" ADD COLUMN "x" int;`,
    );
    expect(problems.join(' ')).toMatch(/does not own|outside schema/);
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

  it('reports the MCP registry hostname named outside the registry client directory', () => {
    const problems = checkSourceBoundaries(
      'src/app/page.tsx',
      "await fetch('https://registry.modelcontextprotocol.io/v0/servers');",
    );
    expect(problems.join(' ')).toMatch(/no-host-sprawl/);
  });

  it('accepts the same hostname inside the registry client directory', () => {
    const problems = checkSourceBoundaries(
      'src/registry/client.ts',
      "await fetch('https://registry.modelcontextprotocol.io/v0/servers');",
    );
    expect(problems).toEqual([]);
  });

  it('does not let one host rule launder another host into the wrong directory', () => {
    // src/github/ is registered for GitHub hosts only. The registry host there
    // is still sprawl, and vice versa — the pairs are not interchangeable.
    expect(
      checkSourceBoundaries(
        'src/github/client.ts',
        "const u = 'https://registry.modelcontextprotocol.io';",
      ).join(' '),
    ).toMatch(/no-host-sprawl/);
    expect(
      checkSourceBoundaries('src/registry/client.ts', "const u = 'https://api.github.com';").join(
        ' ',
      ),
    ).toMatch(/no-host-sprawl/);
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

describe('HOST_RULES covers every client allowlist', () => {
  // The assertion that does the real work. Extending a pattern fixes today's
  // host; only this fixes the next one. A host added to any client's
  // ALLOWED_HOSTS without a registered directory fails here, on the commit that
  // adds it — rule 5 otherwise polices registered hosts only and stays green.
  const allowlists: [string, Set<string>][] = [
    ['src/github/client.ts', githubAllowedHosts],
    ['src/registry/client.ts', registryAllowedHosts],
  ];

  for (const [source, hosts] of allowlists) {
    it(`registers a directory for every host in ${source}`, () => {
      expect(hosts.size).toBeGreaterThan(0);
      for (const host of hosts) {
        const covered = HOST_RULES.some((rule) => rule.pattern.test(host));
        expect(
          covered,
          `${host} is in ${source}'s allowlist but no HOST_RULES pair covers it`,
        ).toBe(true);
      }
    });
  }
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

describe('checkVerdictVocabulary (rule 6, CAP-10/CAP-12)', () => {
  it('reports a hardcoded verdict word in JSX text', () => {
    const problems = checkVerdictVocabulary(
      'export const X = () => <p>This artifact is safe.</p>;',
    );
    expect(problems.join(' ')).toMatch(/no-verdict-vocabulary/);
    expect(problems.join(' ')).toContain('"safe"');
  });

  it('reports the same word in a quoted string literal', () => {
    const problems = checkVerdictVocabulary("const msg = 'This artifact is verified';");
    expect(problems.join(' ')).toMatch(/no-verdict-vocabulary/);
    expect(problems.join(' ')).toContain('"verified"');
  });

  it('reports the banned phrase "risk score"', () => {
    const problems = checkVerdictVocabulary('export const X = () => <p>a risk score of 3</p>;');
    expect(problems.join(' ')).toContain('"risk score"');
  });

  it('reports nothing for a word appearing only inside a comment', () => {
    const source =
      '// This detector is not safe to trust blindly.\n' +
      '/* verified against the fixture corpus */\n' +
      'export const x = 1;';
    expect(checkVerdictVocabulary(source)).toEqual([]);
  });

  it('reports nothing for a UI file that renders a runtime variable, even when its value would contain the word', () => {
    const source = 'const status = getStatus();\nexport const X = () => <p>{status}</p>;';
    expect(checkVerdictVocabulary(source)).toEqual([]);
  });

  it('reports nothing for the un- and -up word forms, with no explicit exception written for them', () => {
    const source =
      'export const X = () => <p>unverified, unsafe, and needs cleanup before merge.</p>;';
    expect(checkVerdictVocabulary(source)).toEqual([]);
  });

  it('excises a SANCTIONED phrase before scanning, so the shipped disclaimer passes', () => {
    const [first] = SANCTIONED;
    // A literal copy of the sanctioned phrase alone reports nothing.
    expect(checkVerdictVocabulary(`const s = '${first.text}';`)).toEqual([]);
    // The same sanctioned phrase, plus an unrelated, un-sanctioned use of the
    // word elsewhere in the same file, still reports — the ledger excises
    // exact substrings, not the word everywhere in the file.
    const withExtra = checkVerdictVocabulary(
      `const s = '${first.text}';\nconst s2 = 'a totally safe file';`,
    );
    expect(withExtra.join(' ')).toMatch(/no-verdict-vocabulary/);
  });

  it('accepts this repository as committed, including the shipped CAP-09 disclaimers', () => {
    for (const file of verdictVocabularyFiles('src')) {
      const problems = checkVerdictVocabulary(readFileSync(file, 'utf8'));
      expect(problems, `${file}: ${problems.join(', ')}`).toEqual([]);
    }
  });
});

describe('verdictVocabularyFiles', () => {
  it('returns a non-empty list against the real tree, scoped to src/app and src/components', () => {
    const walked = verdictVocabularyFiles('src').map((f) => f.split(sep).join('/'));
    expect(walked.length).toBeGreaterThan(0);
    expect(walked.every((f) => f.startsWith('src/app/') || f.startsWith('src/components/'))).toBe(
      true,
    );
  });

  it('excludes a file outside src/app and src/components, including a detector module and a test file', () => {
    const walked = verdictVocabularyFiles('src').map((f) => f.split(sep).join('/'));
    expect(walked).not.toContain('src/detect/skill.ts');
    expect(walked.some((f) => f.includes('.test.'))).toBe(false);
  });
});
