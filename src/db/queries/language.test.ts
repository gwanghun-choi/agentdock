import { sql as dsql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATABASE_SCHEMA = 'agentdock_test';

const DB_URL = process.env.DATABASE_URL;

/**
 * The Phase 41 language set: one case per shape the report names, most of them
 * real descriptions from production's listing (2026-10-26), cut short. The
 * expected class is what a reader of each script would say the description is
 * written in — the judgement is the fixture.
 */
const CASES: { id: string; text: string | null; expect: string | null }[] = [
  { id: 'english', text: 'Use when the user asks to review a pull request.', expect: 'latin' },
  {
    id: 'chinese-simplified',
    text: '当用户要求数学建模、建模竞赛、建模分析、代码求解、结果可视化或生成数学建模论文时使用。',
    expect: 'zh',
  },
  {
    id: 'chinese-traditional',
    text: '當使用者要求整理會議記錄、產生摘要或翻譯文件時使用。',
    expect: 'zh',
  },
  {
    id: 'korean',
    text: '시스템 설계, 확장성, 기술적 의사결정을 위한 소프트웨어 아키텍처 전문가입니다.',
    expect: 'ko',
  },
  {
    id: 'japanese',
    text: 'WCAG 2.2 レベル AA 標準を用いてインクルーシブなデジタルプロダクトを設計・実装・監査します。',
    expect: 'ja',
  },
  {
    id: 'chinese-with-english-terms',
    text: '管理 Runtime Target Context 的 CLI Admin 会话。',
    expect: 'zh',
  },
  {
    id: 'english-with-chinese-triggers',
    text: 'Autonomously improve a generated paper. Use when user says "改论文", "improve paper", or wants to iteratively polish a generated paper.',
    expect: 'latin',
  },
  {
    id: 'english-plus-chinese',
    text: '给一个主题，产出一条有配音字幕的科普讲解视频。Turn any topic into a narrated motion-graphics explainer video in Chinese or English.',
    expect: 'mixed',
  },
  {
    id: 'english-plus-korean',
    text: 'Use when the user says: support escalation, customer support reply, 고객 지원 에스컬레이션, 고객 답변 초안, 지원 티켓 분류.',
    expect: 'mixed',
  },
  {
    id: 'korean-with-english-terms',
    text: 'Build 및 TypeScript 에러 해결 전문가. Build 실패나 타입 에러 발생 시 자동으로 사용.',
    expect: 'ko',
  },
  {
    id: 'chinese-slash-list',
    text: '子 skill（topics/writing/review/formatting/images/publish/sticker/assets）单独触发仅限对已有产物的修改场景。',
    expect: 'zh',
  },
  {
    id: 'code-english',
    text: 'Run `npx prettier --write .` then `git diff --stat` to check formatting.',
    expect: 'latin',
  },
  { id: 'code-chinese', text: '运行 `npm run build` 并检查输出是否有错误', expect: 'zh' },
  { id: 'short-english', text: 'Lint', expect: 'latin' },
  // Two Han characters are Chinese or a Japanese kanji word; nothing says which.
  { id: 'short-han', text: '测试', expect: 'unknown' },
  { id: 'short-kana', text: 'テスト', expect: 'ja' },
  { id: 'no-description', text: null, expect: null },
  { id: 'blank', text: '   ', expect: null },
  { id: 'numbers-and-symbols', text: '2.0 → 3.0 (100%) /=====/', expect: 'unknown' },
  { id: 'cyrillic', text: 'Создать git commit с правильным сообщением', expect: 'other' },
  // Phase 42 review: the middle dot of a transliterated name counted as kana.
  { id: 'chinese-middle-dot', text: '克劳德・代码技能', expect: 'zh' },
  // Phase 42 review: scripts outside the six named ranges read as no letters.
  { id: 'tamil', text: 'குறியீட்டை மதிப்பாய்வு செய்யும் கருவி', expect: 'other' },
  { id: 'georgian', text: 'კოდის მიმოხილვის ინსტრუმენტი', expect: 'other' },
  // The ceiling the report names: Latin letters cannot say this is not English.
  {
    id: 'vietnamese-without-diacritics',
    text: 'Dung khi can ke hoach marketing tong the cho mot ky',
    expect: 'latin',
  },
];

describe.skipIf(!DB_URL)('summaryLanguage', () => {
  let db: typeof import('@/db/client').db;
  let sql: typeof import('@/db/client').sql;
  let summaryLanguage: typeof import('./language').summaryLanguage;

  beforeAll(async () => {
    ({ db, sql } = await import('@/db/client'));
    ({ summaryLanguage } = await import('./language'));
  });

  afterAll(async () => {
    await sql.end();
  });

  it.each(CASES)('$id → $expect', async ({ text, expect: expected }) => {
    const [row] = await db.execute<{ lang: string | null }>(
      dsql`select ${summaryLanguage(dsql`${text}::text`)} as lang`,
    );
    expect(row.lang).toBe(expected);
  });
});
