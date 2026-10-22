import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DETECTORS } from '@/detect';
import { collectCandidates } from '@/detect/run';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// Distinct from every other suite's prefix. The repository names are the real
// ones behind the prefix, so a repository-name query still has something to hit.
const PREFIX = 'eval-spec';

/**
 * The fixed search evaluation set (Phase 6).
 *
 * Corpus: every file fixtures/ captured a body for, run through the real
 * detectors — 155 rows from seven repositories, with their real names,
 * summaries, paths and repository metadata — plus six subagent rows whose
 * summaries are written here, because no agent body was ever captured.
 *
 * Each query names the rows a reader typing it is looking for. Judged by hand
 * on 2026-10-21 from the names and summaries alone; the judgement is the
 * fixture, so a ranking change that moves one of these is a decision to
 * write down, not a test to edit.
 */
type Case = {
  id: string;
  q: string;
  types?: string[];
  /** Substrings of `<repository>/<source_path>` that count as relevant. Empty: nothing should. */
  relevant: string[];
};

export const EVAL_CASES: Case[] = [
  { id: 'exact-name', q: 'pdf', relevant: ['skills/pdf/SKILL.md'] },
  { id: 'exact-hyphen', q: 'canvas-design', relevant: ['skills/canvas-design/SKILL.md'] },
  { id: 'prefix', q: 'brainstorm', relevant: ['skills/brainstorming/SKILL.md'] },
  {
    id: 'partial',
    q: 'debugging',
    relevant: [
      'skills/systematic-debugging/SKILL.md',
      'skills/parallel-debugging/SKILL.md',
      'skills/debugging-and-error-recovery/SKILL.md',
    ],
  },
  {
    id: 'compound',
    q: 'code review',
    relevant: [
      'skills/code-review-and-quality/SKILL.md',
      'skills/requesting-code-review/SKILL.md',
      'skills/receiving-code-review/SKILL.md',
      'plugins/code-review/.claude-plugin/plugin.json',
      'plugins/code-review/commands/code-review.md',
    ],
  },
  { id: 'description-word', q: 'playwright', relevant: ['skills/webapp-testing/SKILL.md'] },
  { id: 'description-phrase', q: 'image generation', relevant: ['baoyu-image-gen/SKILL.md'] },
  {
    id: 'description-synonym',
    q: 'twitter',
    relevant: ['baoyu-post-to-x/SKILL.md', 'baoyu-danger-x-to-markdown/SKILL.md'],
  },
  { id: 'path', q: 'skills/pdf', relevant: ['skills/pdf/SKILL.md'] },
  { id: 'typo', q: 'debuging', relevant: ['debugging'] },
  { id: 'typo-2', q: 'brainstroming', relevant: ['skills/brainstorming/SKILL.md'] },
  { id: 'repo-name', q: 'superpowers', relevant: ['obra--superpowers/'] },
  // The repository's description, "Master Claude Code Hooks", is not searched.
  { id: 'repo-description', q: 'hooks mastery', relevant: ['claude-code-hooks-mastery/'] },
  // obra/superpowers carries the topic; no package text says it.
  { id: 'repo-topic', q: 'sdlc', relevant: ['obra--superpowers/'] },
  { id: 'short', q: 'ai', relevant: [] },
  { id: 'korean', q: '번역', relevant: [] },
  { id: 'cjk', q: '微信', relevant: ['baoyu-post-to-wechat/SKILL.md'] },
  {
    id: 'type-filter',
    q: 'review',
    types: ['command'],
    relevant: ['commands/review-pr.md', 'commands/code-review.md'],
  },
  { id: 'mcp', q: 'mcp', relevant: ['skills/mcp-builder/SKILL.md', 'mcp-integration/SKILL.md'] },
  { id: 'agent-name', q: 'code-reviewer', types: ['agent'], relevant: ['agents/code-reviewer.md'] },
  {
    id: 'agent-description',
    q: 'security audit',
    types: ['agent'],
    relevant: ['agents/security-auditor.md'],
  },
];

const AGENTS = [
  ['addyosmani/agent-skills', 'agents/code-reviewer.md', 'Reviews a change for correctness'],
  ['addyosmani/agent-skills', 'agents/security-auditor.md', 'Audits code for security issues'],
  ['addyosmani/agent-skills', 'agents/test-engineer.md', 'Writes and runs tests'],
  ['disler/claude-code-hooks-mastery', '.claude/agents/meta-agent.md', 'Generates new agents'],
  [
    'anthropics/claude-code',
    'plugins/feature-dev/agents/code-architect.md',
    'Designs feature architecture',
  ],
  ['disler/claude-code-hooks-mastery', '.claude/agents/hello-world-agent.md', 'Greets the user'],
] as const;

type Row = {
  repo: string;
  description: string | null;
  topics: string[];
  type: string;
  path: string;
  name: string;
  summary: string | null;
};

async function corpus(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const slug of readdirSync('fixtures')) {
    let tree: { path: string; type: string; sha: string }[];
    try {
      tree = JSON.parse(readFileSync(`fixtures/${slug}/tree.json`, 'utf8')).tree;
    } catch {
      continue;
    }
    const repo = JSON.parse(readFileSync(`fixtures/${slug}/repo.json`, 'utf8'));
    const captured = new Set(readdirSync(`fixtures/${slug}/files`).map(decodeURIComponent));
    for (const pass of collectCandidates(DETECTORS, tree)) {
      for (const c of pass.candidates) {
        if (c.needs.length === 0 || !captured.has(c.needs[0])) continue;
        const r = await pass.detector.parse(c, async (p) =>
          readFileSync(`fixtures/${slug}/files/${encodeURIComponent(p)}`, 'utf8'),
        );
        if (!r.ok || r.status === 'seeds' || r.status === 'none') continue;
        rows.push({
          repo: repo.full_name,
          description: repo.description,
          topics: repo.topics ?? [],
          type: c.type,
          path: c.sourcePath,
          name: r.artifact.name,
          summary: r.artifact.summary,
        });
      }
    }
  }
  for (const [repo, path, summary] of AGENTS) {
    const base = rows.find((r) => r.repo === repo);
    rows.push({
      repo,
      description: base?.description ?? null,
      topics: base?.topics ?? [],
      type: 'agent',
      path,
      name: path.split('/').at(-1)?.replace(/\.md$/, '') ?? path,
      summary,
    });
  }
  return rows;
}

export type CaseResult = { id: string; total: number; firstRelevant: number | null };

describe.skipIf(!DB_URL)('search evaluation set', () => {
  let search: typeof import('./search');
  let sql: typeof import('@/db/client').sql;
  const results: CaseResult[] = [];

  async function clean() {
    await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}/%`}`;
  }

  beforeAll(async () => {
    search = await import('./search');
    ({ sql } = await import('@/db/client'));
    await clean();
    const rows = await corpus();
    expect(rows.length).toBe(161);
    const repoIds = new Map<string, number>();
    for (const row of rows) {
      let id = repoIds.get(row.repo);
      if (id === undefined) {
        const [r] = await sql<{ id: number }[]>`
          INSERT INTO repository (github_node_id, full_name, owner, default_branch, description, topics)
          VALUES (${`eval-${row.repo}`}, ${`${PREFIX}/${row.repo.replace('/', '--')}`},
                  ${PREFIX}, 'main', ${row.description}, ${row.topics})
          RETURNING id`;
        id = Number(r.id);
        repoIds.set(row.repo, id);
      }
      const [p] = await sql<{ id: number }[]>`
        INSERT INTO package (repository_id, type, source_path, name, slug, summary)
        VALUES (${id}, ${row.type}, ${row.path}, ${row.name}, ${row.name}, ${row.summary})
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (!p) continue;
      await sql`
        INSERT INTO package_version (package_id, commit_sha, content_hash, analyzed_at)
        VALUES (${p.id}, ${'e'.repeat(40)}, ${`eval-${row.repo}-${row.path}`}, now())`;
    }
  });

  afterAll(async () => {
    // SEARCH_EVAL_KEEP leaves the corpus in the local test schema for an
    // EXPLAIN or a threshold measurement by hand; the next run cleans it.
    if (!process.env.SEARCH_EVAL_KEEP) await clean();
    if (process.env.SEARCH_EVAL_REPORT) {
      process.stdout.write(`SEARCH_EVAL ${JSON.stringify(results)}\n`);
    }
    await sql.end();
  });

  async function run(c: Case): Promise<CaseResult> {
    const filters = { types: c.types ?? [], capabilities: [] };
    const mode = await search.searchMode({ q: c.q, filters });
    // The whole result list, scoped to this suite's repositories — other suites
    // share the schema, and their rows are not part of this corpus.
    const rows = (await search.searchPackages({ q: c.q, filters, mode, limit: 1000 })).filter((r) =>
      r.fullName.startsWith(`${PREFIX}/`),
    );
    const index = rows.findIndex((r) =>
      c.relevant.some((s) => `${r.fullName}/${r.sourcePath}`.includes(s)),
    );
    return { id: c.id, total: rows.length, firstRelevant: index === -1 ? null : index + 1 };
  }

  // Pinned to what search returned on 2026-10-21 after Phase 6's one ranking
  // change (pathBonus, which moved `path` from 3 to 1 and nothing else).
  // firstRelevant is the 1-based rank of the first relevant row; null is a
  // known miss, written down in docs/analysis/agentdock-phase6-search-and-ux.md
  // rather than hidden. A change may improve any of these, never worsen one,
  // and a total may not more than double — the flood a looser predicate causes.
  const BASELINE: Record<string, Omit<CaseResult, 'id'>> = {
    'exact-name': { total: 3, firstRelevant: 1 },
    'exact-hyphen': { total: 1, firstRelevant: 1 },
    prefix: { total: 1, firstRelevant: 1 },
    partial: { total: 14, firstRelevant: 1 },
    compound: { total: 11, firstRelevant: 1 },
    'description-word': { total: 1, firstRelevant: 1 },
    'description-phrase': { total: 8, firstRelevant: 2 },
    'description-synonym': { total: 2, firstRelevant: 1 },
    path: { total: 3, firstRelevant: 1 },
    typo: { total: 14, firstRelevant: 1 },
    'typo-2': { total: 0, firstRelevant: null },
    'repo-name': { total: 16, firstRelevant: 1 },
    'repo-description': { total: 12, firstRelevant: 12 },
    'repo-topic': { total: 0, firstRelevant: null },
    short: { total: 7, firstRelevant: null },
    korean: { total: 0, firstRelevant: null },
    cjk: { total: 3, firstRelevant: 2 },
    'type-filter': { total: 2, firstRelevant: 1 },
    mcp: { total: 4, firstRelevant: 1 },
    'agent-name': { total: 1, firstRelevant: 1 },
    'agent-description': { total: 1, firstRelevant: 1 },
  };

  it.each(EVAL_CASES)('$id: $q', async (c) => {
    const result = await run(c);
    results.push(result);
    const pinned = BASELINE[c.id];
    expect(pinned).toBeDefined();
    expect(result.total).toBeLessThanOrEqual(Math.max(2 * pinned.total, 1));
    if (pinned.firstRelevant != null) {
      expect(result.firstRelevant).not.toBeNull();
      expect(result.firstRelevant ?? Infinity).toBeLessThanOrEqual(pinned.firstRelevant);
    }
  });
});
