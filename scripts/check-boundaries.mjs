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
//   6. src/app/** and src/components/** never hardcode a safety verdict —
//      the words CAP-10 forbids — in a JSX text run or a quoted string.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {string} */
export const OWNED_SCHEMA = 'agentdock';

// pg_catalog is the read-only system namespace: qualifying a system function is
// not a boundary escape, and nothing can write to it.
const ALLOWED_SCHEMAS = new Set([OWNED_SCHEMA, 'pg_catalog']);

// A shared extension's operator class is infrastructure, not application data.
// `public` is where PostgreSQL puts a trusted extension and where a shared
// instance most likely already has pg_trgm — verified that way on the intended
// deployment target on 2026-08-12 (pg_extension.extnamespace = 'public',
// pg_opclass gin_trgm_ops in 'public'). Moving it would mutate an object every
// other schema in that database may depend on.
// Referencing it is a read: agentdock_app holds USAGE but not CREATE on
// public, so nothing can be written there, and QUALIFIED_TARGETS below still
// rejects any CREATE/ALTER aimed outside the owned schema. Only these exact
// identifiers are exempt — "public"."users" stays a boundary escape.
const SHARED_EXTENSION_REFS = /\b(?:"public"|public)\s*\.\s*"?(?:gin_trgm_ops|gist_trgm_ops)"?\b/g;

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

  for (const schema of schemasReferenced(sql.replace(SHARED_EXTENSION_REFS, ' '))) {
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
// directory each, so `git grep` answers "what can this reach" completely.
//
// A pair per host family, not one pattern: the third host arrived in Phase 5 and
// the single hardcoded pattern did not match it, so a registry client written
// anywhere would have passed this rule in silence. Adding a host means adding a
// pair here — and the allowlist-coverage test in check-boundaries.test.ts fails
// the build if a client grows a host that no pair covers.
//
// A directory registered before it exists is inert, not an error: sourceFiles
// walks only what is on disk.
/** @type {{ pattern: RegExp, dir: string, label: string }[]} */
export const HOST_RULES = [
  {
    pattern: /api\.github\.com|raw\.githubusercontent\.com/,
    dir: 'src/github/',
    label: 'a GitHub host',
  },
  {
    pattern: /registry\.modelcontextprotocol\.io/,
    dir: 'src/registry/',
    label: 'the MCP registry host',
  },
];

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
  for (const { pattern, dir, label } of HOST_RULES) {
    if (pattern.test(stripped) && !normalized.startsWith(dir)) {
      problems.push(`names ${label} outside ${dir} (no-host-sprawl)`);
    }
  }

  return problems;
}

// Rule 6: CAP-10/CAP-12. A hardcoded safety verdict in UI copy is a failing
// build, not a convention someone has to remember. CONTEXT.md Measurement 7:
// a naive version of this rule fails on page.tsx's own shipped, correct
// disclaimer ("...it cannot say whether it is safe.") on its first run —
// this is why SANCTIONED exists below and ships in the same commit as the
// rule, rather than being bolted on after the first CI failure.
const VERDICT_WORDS = [
  'safe',
  'clean',
  'verified',
  'trusted',
  'approved',
  'malicious',
  'grade',
  'risk score',
];

/**
 * The product's own ledger of every place it is permitted to say one of
 * VERDICT_WORDS. Exact substrings, excised from a file's text before the
 * scan runs, each with the reason it is allowed. Teaching the pattern to
 * recognise negation instead (so "it cannot say whether it is safe" passes
 * on its own) is an unbounded English-grammar problem that would let through
 * a double negative and reject something harmless — an exact list is
 * bounded, is exact, and a reviewer sees every addition to it as a diff.
 * @type {{ text: string, reason: string }[]}
 */
export const SANCTIONED = [
  {
    text: 'AgentDock reads this file; it does not run it, and it cannot say whether it is safe.',
    reason:
      'page.tsx FILE_DISCLAIMER — the shipped CAP-09 sentence this rule must not fail on (Measurement 7).',
  },
  {
    text: 'AgentDock reads files and reports what it read. It does not run them, and it cannot say whether an artifact is safe.',
    reason:
      "page.tsx CAPABILITY_INTRO — the CAP-09 block's opening line, quoting the product claim.",
  },
  {
    text: 'AgentDock cannot tell you whether an artifact is safe.',
    reason: "page.tsx CAPABILITY_NOT_CHECKED — the CAP-09 block's closing line.",
  },
  {
    text: 'AgentDock reads files and reports what it read. It does not run them, and it cannot say whether an artifact is safe. Read anything before you use it.',
    reason: 'layout.tsx FOOTER_DISCLAIMER — the same product claim, shown on every page.',
  },
];

// Anchored with a negative lookbehind for a letter and a trailing word
// boundary, case-insensitive — exempts `unverified`, `unsafe` and `cleanup`
// BY CONSTRUCTION, with no explicit exception list for any of them: a rule
// with one special case invites a second (CONTEXT.md decision 8).
const VERDICT_PATTERN = new RegExp(
  `(?<![a-zA-Z])(${VERDICT_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

// Where a verdict word would actually be shown to a reader: a JS/TS string
// or template literal, or a run of JSX text between two delimiters (a tag
// boundary `>`/`<`, or an expression boundary `{`/`}` — a sentence broken
// across `{expr}` interpolations, like page.tsx's own copy, still has each
// of its plain-text runs bounded by one of these on either side). Approximated
// with regex rather than a parser, per CONTEXT.md's accepted ceiling: a
// dynamically built string (`'ver' + 'ified'`) walks past this, the same
// limit the other five rules already accept for their own patterns.
const STRING_SPAN = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const JSX_TEXT_SPAN = /[>}][^<>{}]+[<{]/g;

/**
 * Rule 6, against one UI file's text. CAP-10 ("never a verdict"), CAP-12
 * ("verbs of observation, never judgment").
 * @param {string} text
 * @returns {string[]}
 */
export function checkVerdictVocabulary(text) {
  let stripped = stripJsComments(text);
  for (const { text: phrase } of SANCTIONED) {
    stripped = stripped.split(phrase).join('');
  }

  /** @type {string[]} */
  const problems = [];
  const found = new Set();

  const scanSpan = (span) => {
    VERDICT_PATTERN.lastIndex = 0;
    let m = VERDICT_PATTERN.exec(span);
    while (m !== null) {
      found.add(m[1].toLowerCase());
      m = VERDICT_PATTERN.exec(span);
    }
  };

  for (const m of stripped.matchAll(STRING_SPAN)) scanSpan(m[0]);
  for (const m of stripped.matchAll(JSX_TEXT_SPAN)) scanSpan(m[0]);

  for (const word of found) {
    problems.push(`hardcoded verdict word "${word}" in UI copy (no-verdict-vocabulary)`);
  }
  return problems;
}

/**
 * The files rule 6 inspects: src/app/** and src/components/** only, because
 * CAP-10 is about copy shown to a user — backend comments, detector
 * rationale and test descriptions (already exempted by sourceFiles' own
 * test-file filter) are out of scope. Exported so the narrowing itself is
 * testable: a scope filter that silently matches nothing is a lint that
 * passes by inspecting zero files, the exact failure sourceFiles' own
 * docstring warns about.
 * @param {string} rootDir @returns {string[]}
 */
export function verdictVocabularyFiles(rootDir = 'src') {
  const out = [];
  for (const name of ['app', 'components']) {
    const dir = join(rootDir, name);
    if (existsSync(dir)) out.push(...sourceFiles(dir));
  }
  return out;
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

  let vocabularyChecked = 0;
  for (const file of verdictVocabularyFiles('src').sort()) {
    vocabularyChecked += 1;
    for (const problem of checkVerdictVocabulary(readFileSync(file, 'utf8'))) {
      problems.push(`${file}: ${problem}`);
    }
  }

  // Say what was inspected, so "0 problems" over 0 files is visible rather than
  // mistaken for a pass.
  console.log(
    `check-boundaries: ${migrationsChecked} migration file(s), package.json, ` +
      `${schemaChecked ? '1' : '0'} schema module, ${sourcesChecked} source file(s), ` +
      `${vocabularyChecked} UI file(s) scanned for verdict vocabulary`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} boundary problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('check-boundaries: OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
