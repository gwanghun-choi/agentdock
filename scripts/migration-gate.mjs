// scripts/migration-gate.mjs
//
// What scripts/migrate.mjs decides before it applies anything to `agentdock`:
// whether the recorded history is the one this checkout expects, which files
// are pending, and whether each pending file may be applied without a person
// naming it first. Pure functions — no connection — so every rule is tested
// without a database (migration-gate.test.ts).
//
// The risk rule is an ALLOWLIST, not a list of dangerous verbs. A statement
// is applied unattended only when it matches one of the additive shapes
// below; anything else — DROP, DELETE, UPDATE, ALTER COLUMN, RENAME, a DO
// block, a shape nobody listed — needs approval. A regex cannot prove a
// migration safe; it can only recognise the few shapes that are safe by
// construction for code already running against the schema (expand, never
// contract), and send everything else to a person.

import { createHash } from 'node:crypto';
import { checkMigrationSql, stripSqlComments } from './check-boundaries.mjs';

/** @typedef {{ sql: string[], folderMillis: number, hash: string }} DiskMigration */
/** @typedef {{ hash: string, created_at: number | string }} AppliedRow */

// A literal default needs no table rewrite on PostgreSQL 11+ (stored in the
// catalog); a volatile one such as now() or gen_random_uuid() rewrites every row.
const LITERAL_DEFAULT =
  /\bDEFAULT\s+(?:'(?:[^']|'')*'(?:::[\w". ]+)?|-?\d+(?:\.\d+)?|true|false|null)(?=\s|,|$)/i;

const ALTER_ADD_COLUMN = /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?("?\w+"?\."?\w+"?) ADD COLUMN /i;
const ALTER_ADD_FK =
  /^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?("?\w+"?\."?\w+"?) ADD CONSTRAINT \S+ FOREIGN KEY /i;
const CREATE_TABLE = /^CREATE TABLE (?:IF NOT EXISTS )?("?\w+"?\."?\w+"?)/i;

const normal = (statement) => stripSqlComments(statement).replace(/\s+/g, ' ').trim();
const ident = (name) => name.replaceAll('"', '').toLowerCase();

/**
 * Why one statement is not on the additive allowlist, or null when it is.
 * `createdHere` is the set of tables this same migration creates: a foreign
 * key on a brand-new table validates zero rows and blocks no running writer.
 * @param {string} statement
 * @param {Set<string>} createdHere
 * @returns {string | null}
 */
export function statementRisk(statement, createdHere) {
  const s = normal(statement);
  if (s === '') return null;
  // One chunk with two statements (a file without breakpoints) is judged by
  // its first one otherwise — "CREATE TABLE …; DROP TABLE …" would pass.
  if (/;\s*\S/.test(s)) return `several statements in one chunk: ${s.slice(0, 80)}…`;
  if (CREATE_TABLE.test(s)) return null;
  if (/^CREATE (?:UNIQUE )?INDEX /i.test(s)) return null;
  if (/^CREATE (?:TYPE|SEQUENCE) /i.test(s)) return null;
  if (/^COMMENT ON /i.test(s)) return null;
  // Reference rows the foreign keys need, idempotent by construction (0009).
  if (/^INSERT INTO "?agentdock"?\."?artifact_type"? .* ON CONFLICT DO NOTHING;?$/i.test(s)) {
    return null;
  }
  if (ALTER_ADD_COLUMN.test(s)) {
    if (/\bGENERATED\b/i.test(s)) return 'adds a generated column, which rewrites the table';
    if (/\bDEFAULT\b/i.test(s) && !LITERAL_DEFAULT.test(s)) {
      return 'adds a column with a non-literal default, which may rewrite the table';
    }
    if (/\bNOT NULL\b/i.test(s) && !/\bDEFAULT\b/i.test(s)) {
      return 'adds a NOT NULL column without a default, which fails on a non-empty table';
    }
    return null;
  }
  const fk = s.match(ALTER_ADD_FK);
  if (fk && createdHere.has(ident(fk[1]))) return null;
  return `not an additive shape: ${s.slice(0, 80)}${s.length > 80 ? '…' : ''}`;
}

/**
 * Every reason a migration needs a person before it is applied. Empty means it
 * may be applied unattended. `blocked` means it may not be applied at all —
 * the boundary scanner already fails CI on the same file.
 * @param {string[]} statements
 * @returns {{ blocked: string[], approval: string[] }}
 */
export function classifyMigration(statements) {
  const whole = statements.join('\n');
  const blocked = checkMigrationSql(whole);
  const createdHere = new Set(
    statements
      .map((st) => normal(st).match(CREATE_TABLE)?.[1])
      .filter(Boolean)
      .map(ident),
  );
  const approval = statements
    .map((st) => statementRisk(st, createdHere))
    .filter((reason) => reason !== null);
  return { blocked, approval };
}

/**
 * The recorded history against the files on disk.
 *
 * scripts/migrate.mjs applies every file newer than the newest recorded
 * `created_at` — drizzle's own rule. That rule silently skips a file older
 * than the newest applied one, and silently ignores a recorded file whose SQL
 * has since changed or which this checkout does not have (an older commit
 * deployed over a newer schema). Each of those is a problem here, and any
 * problem stops the run.
 * @param {AppliedRow[]} applied
 * @param {DiskMigration[]} onDisk
 * @returns {{ problems: string[], pending: DiskMigration[] }}
 */
export function checkHistory(applied, onDisk, tagOf = (m) => String(m.folderMillis)) {
  const problems = [];
  const byMillis = new Map(onDisk.map((m) => [m.folderMillis, m]));
  const appliedMillis = new Set();
  for (const row of applied) {
    const millis = Number(row.created_at);
    appliedMillis.add(millis);
    const disk = byMillis.get(millis);
    if (!disk) {
      problems.push(
        `the database records a migration (created_at ${millis}) that this checkout does not have`,
      );
    } else if (disk.hash !== row.hash) {
      problems.push(`${tagOf(disk)} was edited after it was applied (hash differs)`);
    }
  }
  const newest = applied.length === 0 ? null : Math.max(...appliedMillis);
  const pending = onDisk.filter((m) => newest === null || m.folderMillis > newest);
  for (const m of onDisk) {
    if (newest !== null && m.folderMillis <= newest && !appliedMillis.has(m.folderMillis)) {
      problems.push(`${tagOf(m)} is older than the newest applied migration but was never applied`);
    }
  }
  return { problems, pending };
}

/**
 * The whole decision. `approved` holds the tags a person named for this run.
 * @param {{ applied: AppliedRow[], onDisk: DiskMigration[], tags: Map<number, string>,
 *   approved?: Set<string>, production?: boolean }} input
 */
export function planMigrations({
  applied,
  onDisk,
  tags,
  approved = new Set(),
  production = false,
}) {
  const tagOf = (m) => tags.get(m.folderMillis) ?? String(m.folderMillis);
  const { problems, pending } = checkHistory(applied, onDisk, tagOf);
  // An empty history is a first bootstrap: there is no data to lose and no
  // running code to break, so the risk rule does not apply. A deployment that
  // already serves traffic never has an empty history, so in production an
  // empty one means the URL points somewhere else.
  const bootstrap = applied.length === 0;
  if (bootstrap && production) {
    problems.push('the target records no applied migration — it is not the running deployment');
  }
  const items = pending.map((m) => {
    const tag = tagOf(m);
    const { blocked, approval } = classifyMigration(m.sql);
    return {
      tag,
      blocked,
      approval: bootstrap ? [] : approval,
      approved: approved.has(tag),
    };
  });
  const unknownApprovals = [...approved].filter((t) => !items.some((i) => i.tag === t));
  for (const t of unknownApprovals) problems.push(`approval names ${t}, which is not pending`);

  let verdict = 'AUTO';
  if (problems.length > 0 || items.some((i) => i.blocked.length > 0)) verdict = 'BLOCKED';
  else if (items.some((i) => i.approval.length > 0 && !i.approved)) verdict = 'NEEDS_APPROVAL';
  else if (items.length === 0) verdict = 'UP_TO_DATE';
  return { verdict, problems, items };
}

/**
 * Which database a URL names, without the password and without printing the
 * host: 16 hex characters of sha256("user@host:port/database"). The deploy
 * workflow compares it to a pinned value, so a pasted preview-branch or local
 * URL stops the run. A Neon endpoint that changes host changes the
 * fingerprint, and the run stops until the pin is updated — closed, not open.
 * @param {string} url
 */
export function targetFingerprint(url) {
  const u = new URL(url);
  const id = `${decodeURIComponent(u.username)}@${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname}`;
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

/**
 * Why `url` is not the production database this run was pinned to, or null.
 * The reason never quotes the URL or its host.
 * @param {string | undefined} url
 * @param {string | undefined} pin
 */
export function productionTargetRejection(url, pin) {
  if (!url) return 'DATABASE_URL is not set';
  if (!/^postgres(ql)?:\/\//.test(url))
    return 'DATABASE_URL is not a postgres:// connection string';
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'DATABASE_URL does not parse as a URL';
  }
  if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    return 'DATABASE_URL points at this machine';
  }
  // Neon's pooled endpoint runs PgBouncer in transaction mode; migrations and
  // other session-length work belong on the direct one (VERCEL_DEPLOY.md).
  if (host.includes('-pooler')) return 'DATABASE_URL is the pooled endpoint; use the direct one';
  if (!pin) return 'AGENTDOCK_TARGET_FINGERPRINT is not set';
  const actual = targetFingerprint(url);
  if (actual !== pin.trim()) {
    return `its fingerprint ${actual} does not match the pinned ${pin.trim()}`;
  }
  return null;
}
