import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DETECTORS } from '@/detect';
import { collectCandidates } from '@/detect/run';
import { caseMetrics } from './searchMetrics';

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

const EVAL_CASES: Case[] = [
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
  // plugins/github/.mcp.json joined the corpus in Phase 11; an MCP server is
  // what a reader typing "mcp" is most plainly after, so it is relevant too.
  {
    id: 'mcp',
    q: 'mcp',
    relevant: [
      'skills/mcp-builder/SKILL.md',
      'mcp-integration/SKILL.md',
      'plugins/github/.mcp.json',
    ],
  },
  { id: 'agent-name', q: 'code-reviewer', types: ['agent'], relevant: ['agents/code-reviewer.md'] },
  {
    id: 'agent-description',
    q: 'security audit',
    types: ['agent'],
    relevant: ['agents/security-auditor.md'],
  },
  // Phase 11 additions, judged the same way on 2026-10-22. Grouped by what a
  // reader typed, not by what search currently does with it.
  { id: 'agent-exact', q: 'backend-reviewer', relevant: ['.claude/agents/backend-reviewer.md'] },
  {
    id: 'agent-path',
    q: '.claude/agents/backend-reviewer.md',
    relevant: ['.claude/agents/backend-reviewer.md'],
  },
  {
    id: 'plugin-agent-path',
    q: 'plugins/security/agents/auditor.md',
    relevant: ['plugins/security/agents/auditor.md'],
  },
  {
    id: 'path-directory',
    q: '.claude/commands',
    relevant: ['hooks-mastery/.claude/commands/', 'claude-code/.claude/commands/'],
  },
  // The plugin's hooks.json joined on 2026-10-23, when hooks took the name of
  // the plugin they configure: a component of hookify, as its command is.
  {
    id: 'plugin-name',
    q: 'hookify',
    relevant: [
      'plugins/hookify/.claude-plugin/plugin.json',
      'plugins/hookify/commands/hookify.md',
      'plugins/hookify/hooks/hooks.json',
    ],
  },
  {
    id: 'plugin-name-2',
    q: 'pr-review-toolkit',
    relevant: ['plugins/pr-review-toolkit/.claude-plugin/plugin.json'],
  },
  { id: 'mcp-name', q: 'github', relevant: ['plugins/github/.mcp.json'] },
  {
    id: 'mcp-type',
    q: 'mcp server',
    relevant: [
      'plugins/github/.mcp.json',
      'skills/mcp-builder/SKILL.md',
      'mcp-integration/SKILL.md',
    ],
  },
  { id: 'uppercase', q: 'PDF', relevant: ['skills/pdf/SKILL.md'] },
  { id: 'mixed-case', q: 'Canvas-Design', relevant: ['skills/canvas-design/SKILL.md'] },
  { id: 'underscore-for-hyphen', q: 'canvas_design', relevant: ['skills/canvas-design/SKILL.md'] },
  { id: 'hyphen-for-underscore', q: 'git-status', relevant: ['.claude/commands/git_status.md'] },
  { id: 'underscore-name', q: 'clean_gone', relevant: ['commands/clean_gone.md'] },
  {
    id: 'space-for-hyphen',
    q: 'systematic debugging',
    relevant: ['skills/systematic-debugging/SKILL.md'],
  },
  {
    id: 'space-for-hyphen-2',
    q: 'frontend design',
    relevant: [
      'anthropics--skills/skills/frontend-design/SKILL.md',
      'plugins/frontend-design/skills/frontend-design/SKILL.md',
      'plugins/frontend-design/.claude-plugin/plugin.json',
    ],
  },
  {
    id: 'space-for-hyphen-3',
    q: 'test driven development',
    relevant: ['skills/test-driven-development/SKILL.md'],
  },
  {
    id: 'natural-language',
    q: 'write the tests before the code',
    relevant: ['skills/test-driven-development/SKILL.md'],
  },
  {
    id: 'natural-language-2',
    q: 'convert tweets to markdown',
    relevant: ['baoyu-danger-x-to-markdown/SKILL.md'],
  },
  {
    id: 'multi-word',
    q: 'git commit push',
    relevant: ['commands/commit-push-pr.md', 'plugins/commit-commands/.claude-plugin/plugin.json'],
  },
  {
    id: 'long-query',
    q: 'Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes to the code',
    relevant: ['skills/systematic-debugging/SKILL.md'],
  },
  { id: 'special-chars', q: '@pdf!', relevant: ['skills/pdf/SKILL.md'] },
  { id: 'markup', q: '<script>alert(1)</script>', relevant: [] },
  { id: 'stopword-only', q: 'the', relevant: [] },
  { id: 'no-result', q: 'kubernetes operator', relevant: [] },
  {
    id: 'same-name',
    q: 'frontend-design',
    relevant: [
      'anthropics--skills/skills/frontend-design/SKILL.md',
      'plugins/frontend-design/skills/frontend-design/SKILL.md',
      'plugins/frontend-design/.claude-plugin/plugin.json',
    ],
  },
  { id: 'same-name-2', q: 'help', relevant: ['commands/help.md'] },
  { id: 'cjk-2', q: '微博', relevant: ['baoyu-post-to-weibo/SKILL.md'] },
  { id: 'repo-name-hyphen', q: 'baoyu-skills', relevant: ['JimLiu--baoyu-skills/'] },
  {
    id: 'agent-type-description',
    q: 'architecture',
    types: ['agent'],
    relevant: ['agents/code-architect.md'],
  },
  // Phase 17 additions, judged 2026-10-23: the only two fixture descriptions
  // that name a dotted library, "using p5.js" and "Supports Node.js".
  { id: 'dotted-name', q: 'p5.js', relevant: ['skills/algorithmic-art/SKILL.md'] },
  { id: 'dotted-name-2', q: 'node.js', relevant: ['release-skills/SKILL.md'] },
];

/**
 * Rows no fixture captured a body for, written here: subagents (no agent body
 * was ever captured) and one MCP server, whose stored summary is empty as it is
 * in production (a manifest has no prose). [repository, type, path, summary];
 * the name is the file name, or the plugin directory for a `.mcp.json`.
 */
const SYNTHETIC = [
  [
    'addyosmani/agent-skills',
    'agent',
    'agents/code-reviewer.md',
    'Reviews a change for correctness',
  ],
  [
    'addyosmani/agent-skills',
    'agent',
    'agents/security-auditor.md',
    'Audits code for security issues',
  ],
  ['addyosmani/agent-skills', 'agent', 'agents/test-engineer.md', 'Writes and runs tests'],
  [
    'disler/claude-code-hooks-mastery',
    'agent',
    '.claude/agents/meta-agent.md',
    'Generates new agents',
  ],
  [
    'anthropics/claude-code',
    'agent',
    'plugins/feature-dev/agents/code-architect.md',
    'Designs feature architecture',
  ],
  [
    'disler/claude-code-hooks-mastery',
    'agent',
    '.claude/agents/hello-world-agent.md',
    'Greets the user',
  ],
  // Phase 11. backend-reviewer shares both of its words with other rows'
  // paths and summaries (plugins/backend-development/…, "Reviews a change"),
  // which is what makes its exact-name case a test.
  [
    'wshobson/agents',
    'agent',
    '.claude/agents/backend-reviewer.md',
    'Reviews backend services for API, database and concurrency problems',
  ],
  [
    'wshobson/agents',
    'agent',
    'plugins/security/agents/auditor.md',
    'Reviews dependency manifests and configuration for exposed secrets',
  ],
  ['anthropics/claude-code', 'mcp_server', 'plugins/github/.mcp.json', null],
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
  for (const [repo, type, path, summary] of SYNTHETIC) {
    const base = rows.find((r) => r.repo === repo);
    const file = path.split('/').at(-1) ?? path;
    rows.push({
      repo,
      description: base?.description ?? null,
      topics: base?.topics ?? [],
      type,
      path,
      name: file === '.mcp.json' ? (path.split('/').at(-2) ?? file) : file.replace(/\.md$/, ''),
      summary,
    });
  }
  return rows;
}

describe('caseMetrics', () => {
  it('scores a ranked list against the whole answer', () => {
    expect(caseMetrics([true], 1)).toEqual({
      p5: 0.2,
      p10: 0.1,
      recall10: 1,
      rr: 1,
      ndcg10: 1,
      top1: true,
    });
    const m = caseMetrics([false, true, false, true], 3);
    expect(m.rr).toBe(0.5);
    expect(m.recall10).toBeCloseTo(2 / 3);
    expect(m.ndcg10).toBeCloseTo(
      (1 / Math.log2(3) + 1 / Math.log2(5)) / (1 + 1 / Math.log2(3) + 0.5),
    );
    expect(caseMetrics([], 2)).toMatchObject({ rr: 0, ndcg10: 0, top1: false });
  });
});

type CaseResult = { id: string; total: number; firstRelevant: number | null };

describe.skipIf(!DB_URL)('search evaluation set', () => {
  let search: typeof import('./search');
  let sql: typeof import('@/db/client').sql;
  const results: (CaseResult &
    ReturnType<typeof caseMetrics> & { judged: boolean; top: string[] })[] = [];
  /** `<repository>/<source_path>` of every row this suite stored. */
  const stored: string[] = [];

  async function clean() {
    await sql`DELETE FROM repository WHERE full_name LIKE ${`${PREFIX}/%`}`;
  }

  beforeAll(async () => {
    search = await import('./search');
    ({ sql } = await import('@/db/client'));
    await clean();
    const rows = await corpus();
    expect(rows.length).toBe(164);
    const repoIds = new Map<string, number>();
    for (const row of rows) {
      const fullName = `${PREFIX}/${row.repo.replace('/', '--')}`;
      let id = repoIds.get(row.repo);
      if (id === undefined) {
        const [r] = await sql<{ id: number }[]>`
          INSERT INTO repository (github_node_id, full_name, owner, default_branch, description, topics)
          VALUES (${`eval-${row.repo}`}, ${fullName}, ${PREFIX}, 'main', ${row.description}, ${row.topics})
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
      stored.push(`${fullName}/${row.path}`);
      await sql`
        INSERT INTO package_version (package_id, commit_sha, content_hash, analyzed_at)
        VALUES (${p.id}, ${'e'.repeat(40)}, ${`eval-${row.repo}-${row.path}`}, now())`;
    }
  });

  afterAll(async () => {
    // SEARCH_EVAL_KEEP leaves the corpus in the local test schema for an
    // EXPLAIN or a threshold measurement by hand; the next run cleans it.
    if (!process.env.SEARCH_EVAL_KEEP) await clean();
    if (process.env.SEARCH_EVAL_REPORT) await report();
    await sql.end();
  });

  const isRelevant = (c: Case, key: string) => c.relevant.some((s) => key.includes(s));

  /** Rows, total and order exactly as /artifacts gets them: searchMode once,
   * then the rows. The whole list, scoped to this suite's repositories — other
   * suites share the schema, and their rows are not part of this corpus. */
  async function ranked(c: Case) {
    const filters = { types: c.types ?? [], capabilities: [] };
    const q = search.normalizeQuery(c.q);
    const mode = await search.searchMode({ q, filters });
    return (await search.searchPackages({ q, filters, mode, limit: 1000 })).filter((r) =>
      r.fullName.startsWith(`${PREFIX}/`),
    );
  }

  async function run(c: Case) {
    const rows = await ranked(c);
    const hits = rows.map((r) => isRelevant(c, `${r.fullName}/${r.sourcePath}`));
    const index = hits.indexOf(true);
    return {
      id: c.id,
      total: rows.length,
      firstRelevant: index === -1 ? null : index + 1,
      judged: c.relevant.length > 0,
      top: rows.slice(0, 3).map((r) => `${r.type}:${r.name}`),
      ...caseMetrics(hits, stored.filter((k) => isRelevant(c, k)).length),
    };
  }

  /**
   * `bun run search:eval`. The quality numbers are deterministic; the latency
   * ones are wall clock on whatever database TEST_DATABASE_URL names, so they
   * are printed and never asserted. Latency is the route's own three
   * statements per request — searchMode, then the page's rows and the count in
   * parallel — repeated, over every case.
   */
  function summarize() {
    const judged = results.filter((r) => r.judged);
    const mean = (f: (r: (typeof results)[number]) => number) =>
      judged.reduce((s, r) => s + f(r), 0) / judged.length;
    return {
      queries: results.length,
      judged: judged.length,
      p5: mean((r) => r.p5),
      p10: mean((r) => r.p10),
      recall10: mean((r) => r.recall10),
      mrr: mean((r) => r.rr),
      ndcg10: mean((r) => r.ndcg10),
      top1: mean((r) => (r.top1 ? 1 : 0)),
      zeroResult: mean((r) => (r.total === 0 ? 1 : 0)),
      negativesWithRows: results.filter((r) => !r.judged && r.total > 0).map((r) => r.id),
    };
  }

  async function report() {
    const times: number[] = [];
    const runs = Number(process.env.SEARCH_EVAL_RUNS ?? 10);
    for (let i = 0; i < runs; i++) {
      for (const c of EVAL_CASES) {
        const filters = { types: c.types ?? [], capabilities: [] };
        const q = search.normalizeQuery(c.q);
        const t0 = performance.now();
        const mode = await search.searchMode({ q, filters });
        await Promise.all([
          search.searchPackages({ q, filters, mode }),
          search.countSearchResults({ q, filters, mode }),
        ]);
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
    const summary = {
      ...summarize(),
      latencyMs: { runs: times.length, p50: pct(0.5), p95: pct(0.95) },
    };
    const f = (n: number) => n.toFixed(3);
    for (const r of results) {
      process.stdout.write(
        `SEARCH_EVAL_CASE ${r.id.padEnd(24)} total=${String(r.total).padStart(3)} first=${String(r.firstRelevant ?? '-').padStart(2)} ` +
          `p5=${f(r.p5)} ndcg=${f(r.ndcg10)} rr=${f(r.rr)} top=${r.top.join(' | ')}\n`,
      );
    }
    process.stdout.write(`SEARCH_EVAL_SUMMARY ${JSON.stringify(summary)}\n`);
    process.stdout.write(
      `SEARCH_EVAL ${JSON.stringify(results.map(({ id, total, firstRelevant }) => ({ id, total, firstRelevant })))}\n`,
    );
  }

  // Pinned to what search returned on 2026-10-22 after Phase 11's ranking
  // change (nameWordBonus, which moved `description-phrase` from 2 to 1) and
  // fuzzy guard (`stopword-only` from 50 rows to 0); the other 48 are what the
  // Phase 6 ranking returned for them. firstRelevant is the 1-based rank of the
  // first relevant row; null is a known miss, written down in
  // docs/analysis/agentdock-phase11-search-quality-and-discovery.md rather than
  // hidden. A change may improve any of these, never worsen one, and a total
  // may not more than double — the flood a looser predicate causes.
  const BASELINE: Record<string, Omit<CaseResult, 'id'>> = {
    'exact-name': { total: 3, firstRelevant: 1 },
    'exact-hyphen': { total: 1, firstRelevant: 1 },
    prefix: { total: 1, firstRelevant: 1 },
    partial: { total: 14, firstRelevant: 1 },
    compound: { total: 11, firstRelevant: 1 },
    'description-word': { total: 1, firstRelevant: 1 },
    'description-phrase': { total: 8, firstRelevant: 1 },
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
    mcp: { total: 5, firstRelevant: 1 },
    'agent-name': { total: 1, firstRelevant: 1 },
    'agent-description': { total: 2, firstRelevant: 1 },
    'agent-exact': { total: 2, firstRelevant: 1 },
    'agent-path': { total: 1, firstRelevant: 1 },
    'plugin-agent-path': { total: 1, firstRelevant: 1 },
    'path-directory': { total: 17, firstRelevant: 1 },
    'plugin-name': { total: 7, firstRelevant: 1 },
    'plugin-name-2': { total: 2, firstRelevant: 1 },
    'mcp-name': { total: 5, firstRelevant: 1 },
    'mcp-type': { total: 4, firstRelevant: 1 },
    uppercase: { total: 3, firstRelevant: 1 },
    'mixed-case': { total: 1, firstRelevant: 1 },
    'underscore-for-hyphen': { total: 1, firstRelevant: 1 },
    'hyphen-for-underscore': { total: 1, firstRelevant: 1 },
    'underscore-name': { total: 1, firstRelevant: 1 },
    'space-for-hyphen': { total: 2, firstRelevant: 1 },
    'space-for-hyphen-2': { total: 4, firstRelevant: 1 },
    'space-for-hyphen-3': { total: 2, firstRelevant: 1 },
    'natural-language': { total: 1, firstRelevant: 1 },
    'natural-language-2': { total: 1, firstRelevant: 1 },
    'multi-word': { total: 1, firstRelevant: 1 },
    'long-query': { total: 1, firstRelevant: 1 },
    'special-chars': { total: 3, firstRelevant: 1 },
    markup: { total: 6, firstRelevant: null },
    'stopword-only': { total: 0, firstRelevant: null },
    'no-result': { total: 1, firstRelevant: null },
    'same-name': { total: 4, firstRelevant: 1 },
    'same-name-2': { total: 6, firstRelevant: 1 },
    'cjk-2': { total: 1, firstRelevant: 1 },
    'repo-name-hyphen': { total: 22, firstRelevant: 1 },
    'agent-type-description': { total: 1, firstRelevant: 1 },
    // 2026-10-23, with dotted words kept whole: before it `p5.js` also returned
    // release-skills (total 2) and `node.js` found baoyu-electron-extract only.
    'dotted-name': { total: 1, firstRelevant: 1 },
    'dotted-name-2': { total: 1, firstRelevant: 1 },
  };

  /** The means over the judged cases on that date; a change may not lower either.
   * 52 cases since 2026-10-23 (0.924 / 0.902 over the first 50, unchanged). */
  const PINNED = { mrr: 0.927, ndcg10: 0.906 };

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

  // Runs after every case above: vitest runs a file's tests in order.
  it('holds the pinned mean MRR and NDCG@10', () => {
    expect(results).toHaveLength(EVAL_CASES.length);
    const { mrr, ndcg10 } = summarize();
    expect(mrr).toBeGreaterThanOrEqual(PINNED.mrr);
    expect(ndcg10).toBeGreaterThanOrEqual(PINNED.ndcg10);
  });
});
