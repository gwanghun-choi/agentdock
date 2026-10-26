import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseMetrics } from './searchMetrics';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

// github_node_id prefix, for cleanup only. Repository names are the real ones:
// a query that matches a repository name has to see the name production shows.
const NODE_PREFIX = 'ml-eval-';

/**
 * The multilingual search evaluation set (Phase 43, persisted in Phase 45),
 * kept apart from search.eval.test.ts: different corpus, different question.
 *
 * Corpus: fixtures/multilingual-search.json, 128 of production's 19,113
 * listed artifacts (crawled from the public listing on 2026-10-26: name,
 * description, path, type, repository — the five inputs search reads, since
 * search_vector holds no body). It is every row the full corpus ranked in the
 * top 25 for one of these queries, before or after the CJK substring match,
 * plus every row judged relevant. ts_rank and trigram similarity score a row
 * by itself, with no corpus statistics, so the rows above any of these are
 * the rows above them in the full corpus. Rows tied in rank fall to
 * updated_at, which the fixture does not carry; its order stands in for it,
 * taken from production's own result lists. Measured 2026-10-26: run against
 * e4c2773's search.ts, this file returned production's top 10 for all 14
 * queries, in production's order, and its top 25 for 13 (the 14th lists one
 * row the crawl did not see).
 *
 * ponytail: the corpus is frozen at what search returned on 2026-10-26. A
 * change that starts finding a relevant row outside these 128 scores no
 * better here; recrawl and re-judge when one is expected to (the procedure is
 * in docs/analysis/agentdock-phase45-47-release-and-sync-recovery.md §4).
 *
 * Relevance is binary, judged by hand on 2026-10-26 from name and description
 * alone; the identity is `<repository>/<source_path>`, the stored key. An empty
 * list is a query with no artifact in production that answers it — no answer
 * was invented for it. `en` queries are not judged; they are here so the
 * English results the CJK change must not touch stay pinned.
 */
type Case = { id: string; q: string; lang: 'en' | 'zh' | 'ja' | 'ko'; relevant: string[] };

const MM = 'XiaoMaColtAI/math-modeling-skill';
const MM_SKILLS = `${MM}/dsh-plugin/math-modeling-agent/skills/math-modeling`;
const ECC = 'affaan-m/ECC/docs';

const CASES: Case[] = [
  { id: 'en-math-modeling', q: 'math modeling', lang: 'en', relevant: [] },
  { id: 'en-code-review', q: 'code review', lang: 'en', relevant: [] },
  { id: 'en-document-processing', q: 'document processing', lang: 'en', relevant: [] },
  { id: 'en-browser-automation', q: 'browser automation', lang: 'en', relevant: [] },
  {
    id: 'zh-math-modeling',
    q: '数学建模',
    lang: 'zh',
    relevant: [
      `${MM}/SKILL.md`,
      `${MM_SKILLS}/tools/docx/SKILL.md`,
      `${MM_SKILLS}/tools/latex/SKILL.md`,
      `${MM_SKILLS}/references/roles/建模手/SKILL.md`,
      `${MM_SKILLS}/references/roles/编程手/SKILL.md`,
      `${MM_SKILLS}/references/roles/论文手/SKILL.md`,
    ],
  },
  {
    id: 'zh-code-review',
    q: '代码审查',
    lang: 'zh',
    relevant: [
      'luongnv89/claude-howto/zh/07-plugins/pr-review/commands/check-security.md',
      'luongnv89/claude-howto/zh/03-skills/code-review-specialist/SKILL.md',
      'jnMetaCode/superpowers-zh/skills/receiving-code-review/SKILL.md',
      'fengshao1227/ccg-workflow/templates/commands/agents/team-reviewer.md',
      'fengshao1227/ccg-workflow/dsh-ccg/skills/verify-change/SKILL.md',
    ],
  },
  // A known miss: the relevant rows say 文件/文本/PDF, never 文档处理.
  {
    id: 'zh-document-processing',
    q: '文档处理',
    lang: 'zh',
    relevant: [
      'Light0305/Light-skills/skills/light-file-reading/SKILL.md',
      'staruhub/ClaudeSkills/skills/Geek-skills-mineru-pdf-parser/SKILL.md',
      'davepoon/buildwithclaude/plugins/all-skills/skills/doc-ocr/SKILL.md',
      `${MM_SKILLS}/tools/docx/SKILL.md`,
      'alchaincyf/huashu-skills/huashu-md-to-pdf/SKILL.md',
    ],
  },
  {
    id: 'zh-browser-automation',
    q: '浏览器自动化',
    lang: 'zh',
    relevant: [
      'skillmds/skillmd/plugins/mcp-security-audit-pipeline/skills/browser-automation/SKILL.md',
      'coco-research/coco/systems/reverse-skill/skills/browser-automation/SKILL.md',
      'zenstory-ai/oh-story-claudecode/skills/story-setup/references/opencode/commands/browser-cdp.md',
      'zenstory-ai/oh-story-claudecode/skills/story-setup/references/zcode/commands/browser-cdp.md',
    ],
  },
  { id: 'ja-math-modeling', q: '数学モデリング', lang: 'ja', relevant: [] },
  // Ten of them: the rest say レビュアー (reviewer), which no substring of the query matches.
  {
    id: 'ja-code-review',
    q: 'コードレビュー',
    lang: 'ja',
    relevant: [
      `${ECC}/ja-JP/commands/astra-review.md`,
      `${ECC}/ja-JP/agents/code-reviewer.md`,
      `${ECC}/ja-JP/commands/cpp-review.md`,
      `${ECC}/ja-JP/commands/fastapi-review.md`,
      `${ECC}/ja-JP/agents/fastapi-reviewer.md`,
      `${ECC}/ja-JP/commands/flutter-review.md`,
      `${ECC}/ja-JP/agents/flutter-reviewer.md`,
      `${ECC}/ja-JP/commands/go-review.md`,
      `${ECC}/ja-JP/agents/java-reviewer.md`,
      `${ECC}/ja-JP/agents/kotlin-reviewer.md`,
    ],
  },
  { id: 'ja-document-processing', q: '文書処理', lang: 'ja', relevant: [] },
  { id: 'ko-math-modeling', q: '수학 모델링', lang: 'ko', relevant: [] },
  {
    id: 'ko-code-review',
    q: '코드 리뷰',
    lang: 'ko',
    relevant: [`${ECC}/ko-KR/agents/code-reviewer.md`, `${ECC}/ko-KR/agents/go-reviewer.md`],
  },
  { id: 'ko-document-processing', q: '문서 처리', lang: 'ko', relevant: [] },
];

type Row = { repo: string; type: string; path: string; name: string; summary: string | null };
type CaseResult = { id: string; total: number; firstRelevant: number | null };

describe.skipIf(!DB_URL)('multilingual search evaluation set', () => {
  let search: typeof import('./search');
  let sql: typeof import('@/db/client').sql;
  const results: (CaseResult &
    ReturnType<typeof caseMetrics> & { judged: boolean; top: string[] })[] = [];
  const repos = new Set<string>();

  async function clean() {
    await sql`DELETE FROM repository WHERE github_node_id LIKE ${`${NODE_PREFIX}%`}`;
  }

  beforeAll(async () => {
    search = await import('./search');
    ({ sql } = await import('@/db/client'));
    await clean();
    const rows: Row[] = JSON.parse(readFileSync('fixtures/multilingual-search.json', 'utf8'));
    expect(rows.length).toBe(128);
    const ids = new Map<string, number>();
    for (const repo of new Set(rows.map((r) => r.repo))) {
      const [r] = await sql<{ id: number }[]>`
        INSERT INTO repository (github_node_id, full_name, owner, default_branch)
        VALUES (${`${NODE_PREFIX}${repo}`}, ${repo}, ${repo.split('/')[0]}, 'main')
        RETURNING id`;
      ids.set(repo, Number(r.id));
      repos.add(repo);
    }
    // One statement: every row gets the same updated_at, so ties in rank fall
    // to id, which is fixture order — production's listing by name, the order
    // the crawl read it in and the full corpus was loaded in.
    const packages = await sql<{ id: number }[]>`
      INSERT INTO package ${sql(
        rows.map((r) => ({
          repository_id: ids.get(r.repo) ?? null,
          type: r.type,
          source_path: r.path,
          name: r.name,
          slug: r.name,
          summary: r.summary,
        })),
      )}
      RETURNING id`;
    await sql`
      INSERT INTO package_version ${sql(
        packages.map((p) => ({
          package_id: p.id,
          commit_sha: 'e'.repeat(40),
          content_hash: `${NODE_PREFIX}${p.id}`,
        })),
      )}`;
  });

  afterAll(async () => {
    // Nothing of this corpus may outlive the run: loaded beside search.eval's
    // rows it changes that set's answers (measured 2026-10-26, three cases).
    await clean();
    if (process.env.SEARCH_EVAL_REPORT) report();
    await sql.end();
  });

  async function run(c: Case) {
    const filters = { types: [], capabilities: [] };
    const q = search.normalizeQuery(c.q);
    const mode = await search.searchMode({ q, filters });
    const rows = (await search.searchPackages({ q, filters, mode, limit: 1000 })).filter((r) =>
      repos.has(r.fullName),
    );
    const relevant = new Set(c.relevant);
    const hits = rows.map((r) => relevant.has(`${r.fullName}/${r.sourcePath}`));
    const index = hits.indexOf(true);
    return {
      id: c.id,
      total: rows.length,
      firstRelevant: index === -1 ? null : index + 1,
      judged: relevant.size > 0,
      top: rows.slice(0, 25).map((r) => `${r.fullName}/${r.sourcePath}`),
      ...caseMetrics(hits, relevant.size),
    };
  }

  function summarize() {
    const judged = results.filter((r) => r.judged);
    const mean = (f: (r: (typeof results)[number]) => number) =>
      judged.reduce((s, r) => s + f(r), 0) / judged.length;
    const cjk = results.filter((r) => !r.id.startsWith('en-'));
    return {
      judged: judged.length,
      recall10: mean((r) => r.recall10),
      mrr: mean((r) => r.rr),
      ndcg10: mean((r) => r.ndcg10),
      cjkZeroResult: cjk.filter((r) => r.total === 0).length / cjk.length,
    };
  }

  /** `bun run search:eval:multilingual`. Quality only; latency on 128 rows says nothing. */
  function report() {
    const f = (n: number) => n.toFixed(3);
    for (const r of results) {
      process.stdout.write(
        `MULTILINGUAL_EVAL_CASE ${r.id.padEnd(24)} total=${String(r.total).padStart(3)} first=${String(r.firstRelevant ?? '-').padStart(2)} ` +
          `recall10=${f(r.recall10)} ndcg=${f(r.ndcg10)} rr=${f(r.rr)}\n`,
      );
    }
    process.stdout.write(`MULTILINGUAL_EVAL_SUMMARY ${JSON.stringify(summarize())}\n`);
    // The order, for a comparison with what production's /artifacts?q= listed.
    process.stdout.write(
      `MULTILINGUAL_EVAL_RANKS ${JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r.top])))}\n`,
    );
  }

  // Pinned to what search returned on 2026-10-26 with the CJK substring match.
  // Before it (e4c2773, the search production runs): 数学建模 total 4, first 1;
  // 代码审查 3, first 2; 浏览器自动化 2, first 1; コードレビュー 1, first 1;
  // 코드 리뷰 2, first 1; 문서 처리 7 — mean R@10 0.417, MRR 0.750, NDCG@10
  // 0.481 over the six judged, four of ten CJK queries with no result. The
  // English four are identical in both. 문서 처리 fell from 7 rows to 2 because
  // two rows now hold both words, so `any` is no longer needed; none of the
  // seven answered it. A change may improve any case, never worsen one, and a
  // total may not more than double.
  const BASELINE: Record<string, Omit<CaseResult, 'id'>> = {
    'en-math-modeling': { total: 21, firstRelevant: null },
    'en-code-review': { total: 31, firstRelevant: null },
    'en-document-processing': { total: 25, firstRelevant: null },
    'en-browser-automation': { total: 25, firstRelevant: null },
    'zh-math-modeling': { total: 7, firstRelevant: 1 },
    'zh-code-review': { total: 6, firstRelevant: 2 },
    'zh-document-processing': { total: 0, firstRelevant: null },
    'zh-browser-automation': { total: 4, firstRelevant: 1 },
    'ja-math-modeling': { total: 0, firstRelevant: null },
    'ja-code-review': { total: 3, firstRelevant: 1 },
    'ja-document-processing': { total: 0, firstRelevant: null },
    'ko-math-modeling': { total: 0, firstRelevant: null },
    'ko-code-review': { total: 2, firstRelevant: 1 },
    'ko-document-processing': { total: 2, firstRelevant: null },
  };

  /** The means over the six judged on that date; a change may not lower one. */
  const PINNED = { recall10: 0.716, mrr: 0.75, ndcg10: 0.703 };

  it.each(CASES)('$id: $q', async (c) => {
    const result = await run(c);
    results.push(result);
    const pinned = BASELINE[c.id];
    expect(pinned).toBeDefined();
    expect(result.total).toBeLessThanOrEqual(Math.max(2 * pinned.total, 1));
    if (pinned.firstRelevant != null) {
      expect(result.firstRelevant ?? Infinity).toBeLessThanOrEqual(pinned.firstRelevant);
    }
  });

  it('holds the pinned mean recall@10, MRR and NDCG@10', () => {
    expect(results).toHaveLength(CASES.length);
    const { recall10, mrr, ndcg10 } = summarize();
    expect(recall10).toBeGreaterThanOrEqual(PINNED.recall10);
    expect(mrr).toBeGreaterThanOrEqual(PINNED.mrr);
    expect(ndcg10).toBeGreaterThanOrEqual(PINNED.ndcg10);
  });
});
