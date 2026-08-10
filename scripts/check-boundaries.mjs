#!/usr/bin/env node
// scripts/check-boundaries.mjs
//
// Refuses to let AgentDock's tooling reach outside the `agentdock` schema.
// Run by `bun run check:boundaries`, by `bun run ci`, and by CI on every push.
// Exit 0 means all four rules below hold.
//
//   1. Every schema a committed migration names is one AgentDock owns.
//   2. Every CREATE/ALTER target in a migration is schema-qualified.
//   3. A destructive verb needs an explicit review marker in the same file.
//   4. No package.json script reaches a live-diffing migration command, and
//      every Drizzle table hangs off pgSchema().
//   5. Application source cannot execute a scanned repository, write its
//      content to disk, render raw HTML, or name a host outside src/github/.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {string} */
export const OWNED_SCHEMA = 'agentdock';

// pg_catalog is the read-only system namespace: qualifying a system function is
// not a boundary escape, and nothing can write to it.
const ALLOWED_SCHEMAS = new Set([OWNED_SCHEMA, 'pg_catalog']);

const REVIEW_MARKER = 'agentdock:reviewed-destructive';

// CREATE/ALTER SCHEMA is in here on purpose. agentdock_app has no CREATE on the
// database, so a migration containing one cannot succeed — and drizzle-kit emits
// exactly that statement for a pgSchema() in the first migration it generates.
// Requiring a marker turns a confusing apply-time failure into a review-time stop.
const DESTRUCTIVE =
  /\b(DROP|TRUNCATE|GRANT|REVOKE|CREATE\s+ROLE|ALTER\s+ROLE|CREATE\s+SCHEMA|ALTER\s+SCHEMA|CREATE\s+EXTENSION|CREATE\s+DATABASE)\b/i;

const QUALIFIED_TARGETS = [
  ['CREATE TABLE', /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi],
  ['ALTER TABLE', /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(\S+)/gi],
  ['CREATE TYPE', /\bCREATE\s+TYPE\s+(\S+)/gi],
  ['CREATE VIEW', /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\S+)/gi],
  ['CREATE SEQUENCE', /\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi],
  [
    'CREATE INDEX ... ON',
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(\S+)/gi,
  ],
];

/**
 * Drops -- line comments and block comments so rules match SQL, not prose.
 * @param {string} sql
 * @returns {string}
 */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Drops JS block and line comments, so a rule matches code and not the prose
 * that explains the rule.
 *
 * The `//` match deliberately refuses to fire after a `:`. A naive line-comment
 * strip eats the `//` in `https://api.github.com/...` and everything after it,
 * which would silently reduce the host rule below to matching nothing at all —
 * exactly the case it exists to catch.
 * @param {string} text
 * @returns {string}
 */
export function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * @param {string} identifier
 * @returns {string}
 */
function unquote(identifier) {
  return identifier.replace(/^[("]+|[)";,]+$/g, '');
}

/**
 * Every schema name the SQL mentions, as a qualifier or in a SCHEMA statement.
 * @param {string} sql
 * @returns {Set<string>}
 */
export function schemasReferenced(sql) {
  /** @type {Set<string>} */
  const found = new Set();
  for (const m of sql.matchAll(/(?:"([A-Za-z_][\w$]*)"|\b([A-Za-z_][\w$]*))\s*\.\s*["A-Za-z_]/g)) {
    found.add(m[1] ?? m[2]);
  }
  for (const m of sql.matchAll(
    /\b(?:CREATE|DROP|ALTER)\s+SCHEMA\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([A-Za-z_][\w$]*)"?/gi,
  )) {
    found.add(m[1]);
  }
  return found;
}

/**
 * Rules 1-3, against one migration file's text.
 * @param {string} rawSql
 * @param {string} [ownedSchema]
 * @returns {string[]}
 */
export function checkMigrationSql(rawSql, ownedSchema = OWNED_SCHEMA) {
  /** @type {string[]} */
  const problems = [];
  const sql = stripSqlComments(rawSql);
  const allowed = new Set([...ALLOWED_SCHEMAS, ownedSchema]);

  for (const schema of schemasReferenced(sql)) {
    if (!allowed.has(schema)) {
      problems.push(`names schema "${schema}", which AgentDock does not own`);
    }
  }

  for (const [label, re] of QUALIFIED_TARGETS) {
    for (const m of sql.matchAll(re)) {
      const target = unquote(m[1]);
      if (!target.includes('.')) {
        problems.push(`${label} target "${target}" is not schema-qualified`);
        continue;
      }
      const schema = unquote(target.split('.')[0]);
      if (schema !== ownedSchema) {
        problems.push(`${label} target "${target}" is outside schema "${ownedSchema}"`);
      }
    }
  }

  const destructive = sql.match(DESTRUCTIVE);
  if (destructive && !rawSql.includes(REVIEW_MARKER)) {
    problems.push(
      `contains "${destructive[0]}" without a review marker. ` +
        `If it is intended, add a comment containing "${REVIEW_MARKER}: <reason>".`,
    );
  }

  return problems;
}

/**
 * Rule 4a: no reachable command that diffs live database state.
 * @param {string} packageJsonText
 * @returns {string[]}
 */
export function checkPackageScripts(packageJsonText) {
  /** @type {string[]} */
  const problems = [];
  const scripts = JSON.parse(packageJsonText).scripts ?? {};
  for (const [name, body] of Object.entries(scripts)) {
    if (/drizzle-kit\s+(push|pull)/i.test(String(body))) {
      problems.push(`script "${name}" invokes a migration command that diffs live database state`);
    }
    if (/^db:(push|pull)$/i.test(name)) {
      problems.push(`script "${name}" uses a banned script name`);
    }
  }
  return problems;
}

/**
 * Rule 4b: every table hangs off pgSchema(), never a bare table builder.
 * @param {string} text
 * @returns {string[]}
 */
export function checkSchemaModule(text) {
  /** @type {string[]} */
  const problems = [];
  const stripped = stripJsComments(text);
  if (!/pgSchema\s*\(/.test(stripped)) {
    problems.push('does not call pgSchema(); tables would land in the default schema');
  }
  if (/(^|[^.\w])pgTable\s*\(/.test(stripped)) {
    problems.push('calls a bare table builder; every table must hang off the pgSchema() object');
  }
  return problems;
}

// Rule 5: four properties of application source that no later commit may undo.
// Each is a requirement that is structurally enforceable, so it is enforced here
// rather than remembered.
const SOURCE_RULES = [
  {
    id: 'no-raw-html',
    // REN-01. Without a raw-HTML plugin, markup in a body is never parsed into
    // element nodes at all — HTML is text, not markup. Reintroducing one, or
    // reaching for React's raw-HTML escape hatch, defeats the control.
    pattern: /rehype-raw|dangerouslySetInnerHTML|allowDangerousHtml/,
    message: 'reintroduces raw HTML into the render path',
  },
  {
    id: 'no-execution',
    // ING-10. Nothing from a scanned repository is ever executed.
    pattern: /node:child_process|require\(['"]child_process|\bexecSync\b|\bspawnSync\b|node:vm\b/,
    message: 'can execute a subprocess or evaluate code',
  },
  {
    id: 'no-disk-write',
    // ING-05. Not writing repository content to disk removes the archive
    // extraction and path traversal classes by construction.
    pattern: /writeFileSync|writeFile\s*\(|createWriteStream|appendFileSync|mkdirSync/,
    message: 'writes to disk',
  },
];

// ING-02, in auditable form: the hostnames AgentDock may contact appear in one
// directory, so `git grep` answers "what can this reach" completely.
const HOST_PATTERN = /api\.github\.com|raw\.githubusercontent\.com/;
const HOST_DIR = 'src/github/';

/**
 * The files rule 5 inspects. Exported so the test-file exemption is checkable:
 * it is the one part of this rule whose failure would be silent.
 * @param {string} dir @returns {string[]}
 */
export function sourceFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(name)) continue;
    // Test files read fixtures from disk and name hostile strings on purpose.
    if (/\.test\.(ts|tsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Rule 5, against one source file's text.
 * @param {string} path
 * @param {string} text
 * @returns {string[]}
 */
export function checkSourceBoundaries(path, text) {
  /** @type {string[]} */
  const problems = [];
  const stripped = stripJsComments(text);

  for (const rule of SOURCE_RULES) {
    if (rule.pattern.test(stripped)) problems.push(`${rule.message} (${rule.id})`);
  }

  const normalized = path.split(sep).join('/');
  if (HOST_PATTERN.test(stripped) && !normalized.startsWith(HOST_DIR)) {
    problems.push(`names a GitHub host outside ${HOST_DIR} (no-host-sprawl)`);
  }

  return problems;
}

function main() {
  /** @type {string[]} */
  const problems = [];
  let migrationsChecked = 0;

  const migrationsDir = process.env.MIGRATIONS_OUT ?? 'drizzle';
  if (existsSync(migrationsDir)) {
    for (const file of readdirSync(migrationsDir)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      migrationsChecked += 1;
      for (const problem of checkMigrationSql(readFileSync(join(migrationsDir, file), 'utf8'))) {
        problems.push(`${migrationsDir}/${file}: ${problem}`);
      }
    }
  }

  for (const problem of checkPackageScripts(readFileSync('package.json', 'utf8'))) {
    problems.push(`package.json: ${problem}`);
  }

  const schemaPath = 'src/db/schema.ts';
  const schemaChecked = existsSync(schemaPath);
  if (schemaChecked) {
    for (const problem of checkSchemaModule(readFileSync(schemaPath, 'utf8'))) {
      problems.push(`${schemaPath}: ${problem}`);
    }
  }

  let sourcesChecked = 0;
  if (existsSync('src')) {
    for (const file of sourceFiles('src').sort()) {
      sourcesChecked += 1;
      for (const problem of checkSourceBoundaries(file, readFileSync(file, 'utf8'))) {
        problems.push(`${file}: ${problem}`);
      }
    }
  }

  // Say what was inspected, so "0 problems" over 0 files is visible rather than
  // mistaken for a pass.
  console.log(
    `check-boundaries: ${migrationsChecked} migration file(s), package.json, ` +
      `${schemaChecked ? '1' : '0'} schema module, ${sourcesChecked} source file(s)`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} boundary problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
