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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  if (!/pgSchema\s*\(/.test(stripped)) {
    problems.push('does not call pgSchema(); tables would land in the default schema');
  }
  if (/(^|[^.\w])pgTable\s*\(/.test(stripped)) {
    problems.push('calls a bare table builder; every table must hang off the pgSchema() object');
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

  // Say what was inspected, so "0 problems" over 0 files is visible rather than
  // mistaken for a pass.
  console.log(
    `check-boundaries: ${migrationsChecked} migration file(s), package.json, ` +
      `${schemaChecked ? '1' : '0'} schema module`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} boundary problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
