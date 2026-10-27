import { type SQL, sql } from 'drizzle-orm';
import { packageTable } from '@/db/schema';

/**
 * The writing system an artifact's description is in, read from the characters
 * themselves — never from a translation, a service or the repository's metadata.
 * The description is the frontmatter or manifest `description` stored verbatim
 * (src/detect/skill.ts), so this says what the author wrote, nothing more.
 *
 *   latin    Latin letters, under a tenth CJK. Not called English, because
 *            the characters cannot say so: measured 2026-10-26 on 17,082 of
 *            production's listed descriptions in this class, a trigram
 *            detector (eld) put 205 (1.2%) in another language — Spanish and
 *            Portuguese translations, Vietnamese written without diacritics —
 *            and a sample read by hand bore nearly all of them out; an
 *            English-stopword test missed short English and passed that
 *            Vietnamese (docs/analysis/agentdock-phase41-multilingual-discovery.md).
 *   zh ja ko a tenth or more CJK, and no Latin sentence beside it.
 *            Kana marks Japanese; Hangul, Korean; Han alone, Chinese — both
 *            scripts, simplified and traditional. Fewer than four Han
 *            characters alone is `unknown`: a Japanese kanji compound is
 *            Han-only too.
 *   mixed    a tenth or more CJK AND six Latin words in a row: a bilingual
 *            description, or a translation appended to one.
 *   other    letters, mostly in no script above (Cyrillic, Arabic, Thai...).
 *   unknown  no letter in any range below, or too short to tell.
 *   null     no description stored.
 *
 * SQL, not TypeScript, because the language filter is a WHERE conjunct: the rows
 * query and the count query have to evaluate the identical expression, or the
 * paginator's last page stops existing (search.ts, searchWhere). Every range is
 * a code-point range rather than a POSIX class, because `[[:alpha:]]` follows
 * the database's collation and this must not change between a local container
 * and Neon.
 *
 * ponytail: computed per row at query time, so a language filter scans every
 * listed row. The predicate reads package columns only, so the planner applies
 * it in the scan, before the text match. Measured 2026-10-26 on the local PG17
 * with production's 19,113 descriptions loaded: browsing 86 ms unfiltered,
 * 84 ms with lang=zh, 158 ms with lang=latin; `review` 23 ms unfiltered, 81 ms
 * with lang=zh. Unfiltered, it is projected after the sort, for the rows up to
 * the page's end (OFFSET rows are computed, then dropped, like the commitSha
 * subquery beside it): measured 2026-10-26, page 1 and the home page unchanged,
 * browse at offset 9,000 157 → 199 ms, at offset 19,000 218 → 307 ms.
 * Revisit when a filtered listing passes 200 ms — about 25k rows at this rate.
 * The upgrade is a STORED generated column, which rewrites a populated table:
 * a migration to approve, not a refactor.
 */
export type SummaryLanguage = 'latin' | 'zh' | 'ja' | 'ko' | 'mixed' | 'other' | 'unknown';

const HAN = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\U00020000-\\U0002fa1f';
// Without U+30FB '・' and U+30FC 'ー': Chinese writes the middle dot between
// the parts of a transliterated name, and one of them made a short Chinese
// description `ja` (review, 2026-10-26). Japanese text has other kana beside them.
const KANA = '\\u3040-\\u30fa\\u30fd-\\u30ff\\u31f0-\\u31ff\\uff66-\\uff9f';
const HANGUL = '\\u1100-\\u11ff\\u3130-\\u318f\\uac00-\\ud7af';
const LATIN = 'A-Za-z\\u00c0-\\u00d6\\u00d8-\\u00f6\\u00f8-\\u024f';
// Greek through Georgian (Cyrillic, Armenian, Hebrew, Arabic, every Indic
// script, Thai, Lao, Tibetan, Myanmar), Ethiopic, Khmer. Named one by one
// before 2026-10-26, which left Bengali or Tamil `unknown` (review).
const OTHER = '\\u0370-\\u10ff\\u1200-\\u139f\\u1780-\\u17ff';
/**
 * Six whitespace-separated Latin words. A word may carry digits and inner
 * punctuation ("GPT-6", "tasks.md"), so "topics/writing/review/..." is one word:
 * measured 2026-10-26, splitting on '/' called a Chinese description `mixed`
 * on the strength of one slash-separated list of skill names.
 */
const LATIN_SENTENCE = `([${LATIN}][${LATIN}0-9'._/-]*[,;:!?"()]*\\s+){5}[${LATIN}]`;

/**
 * How many characters of `text` fall in `ranges`: the length the runs of them
 * take up. Measured 2026-10-26 on the 1,132 CJK-bearing descriptions: deleting
 * every other character instead (`[^...]`) took 60 ms per count, regexp_count
 * 27–35 ms, deleting the runs 17–20 ms.
 */
function only(text: SQL, ranges: string): SQL {
  return sql`(length(${text}) - length(regexp_replace(${text}, ${`[${ranges}]+`}, '', 'g')))`;
}

/** As `only`, but a `~` test first: most CJK descriptions hold no kana, no Hangul. */
function counted(text: SQL, ranges: string): SQL {
  return sql`case when ${text} ~ ${`[${ranges}]`} then ${only(text, ranges)} else 0 end`;
}

/**
 * The classification above, over any text expression. Exported for its test.
 *
 * Counting is the cost, so only the rows that need a count pay for one: a
 * description with no CJK and no other-script letter — 94% of production's —
 * is decided by `~` tests alone. Measured 2026-10-26 over 18,995 production
 * descriptions on the local PG17: five counts on every row took 11.1 s; this
 * shape, which returns the identical class for all 18,995, 75 ms.
 *
 * The `offset 0` keeps PostgreSQL from flattening `c` into the CASE, which
 * pasted each count in at every reference to it: five CJK counts for a zh row.
 * Measured 2026-10-27 with production's 19,113 descriptions loaded locally:
 * 0.038 → 0.020 ms per CJK-bearing row (1,132 of them), the browse page
 * 148.5 → 127.8 ms p50, and the identical class on all 19,113
 * (docs/analysis/agentdock-phase65-language-sql-optimization.md).
 */
export function summaryLanguage(text: SQL): SQL<SummaryLanguage | null> {
  return sql<SummaryLanguage | null>`(
    select case
      when t.s is null or btrim(t.s) = '' then null
      when t.s !~ ${`[${HAN}${KANA}${HANGUL}]`} then
        case
          when t.s !~ ${`[${OTHER}]`} then
            case when t.s ~ ${`[${LATIN}]`} then 'latin' else 'unknown' end
          when ${only(sql`t.s`, LATIN)} >= ${only(sql`t.s`, OTHER)} then 'latin'
          else 'other'
        end
      else (
        select case
          when c.cjk * 10 < c.cjk + c.latin + c.other then
            case when c.latin >= c.other then 'latin' else 'other' end
          when t.s ~ ${LATIN_SENTENCE} then 'mixed'
          when c.hangul * 2 >= c.cjk then 'ko'
          when c.kana * 10 >= c.cjk then 'ja'
          when c.cjk < 4 then 'unknown'
          else 'zh'
        end
        from (
          select ${only(sql`t.s`, `${HAN}${KANA}${HANGUL}`)} as cjk,
                 ${counted(sql`t.s`, KANA)} as kana,
                 ${counted(sql`t.s`, HANGUL)} as hangul,
                 ${only(sql`t.s`, LATIN)} as latin,
                 ${counted(sql`t.s`, OTHER)} as other
          offset 0
        ) c
      )
    end
    from (select ${text}::text as s) t
  )`;
}

/** The one instance every query projects and filters by, like NOT_LISTED_BECAUSE. */
export const SUMMARY_LANGUAGE = summaryLanguage(sql`${packageTable.summary}`);

/**
 * The classes a listing leaves out until a reader names a language — the home
 * page, browse and search with no `lang`. Nothing is deleted or delisted: the
 * rows stay in the database, on their repository's page and at their own URL,
 * and `lang=zh` or `lang=any` lists them again. Emptying this array is the
 * whole revert.
 *
 * `zh` only. Measured 2026-10-26 on production's 19,113 listed descriptions:
 * 609 zh (3.2%), 169 ja, 37 ko, 59 mixed. Japanese and Korean are their own
 * classes and are not hidden with it: kana at a tenth or more of the CJK makes
 * a description ja, Hangul at half or more makes it ko. `mixed` stays listed:
 * it holds a six-word Latin sentence by definition (46 of the 59 hold Han with
 * no kana or Hangul — Chinese beside English). The ceiling: Japanese written
 * mostly in kanji, with kana under a tenth of its CJK, is `zh` and is hidden
 * with it, as the classification above already names.
 */
export const HIDDEN_UNLESS_ASKED: readonly CjkLanguage[] = ['zh'];

/** The classes that need a CJK character — the only ones visibleLanguage can hide. */
export type CjkLanguage = 'zh' | 'ja' | 'ko' | 'mixed';

/**
 * True for a row whose description is in none of `hidden`, including a row
 * with no description at all (SUMMARY_LANGUAGE null).
 *
 * The `~` test first because every class it can hide needs a CJK character
 * (CjkLanguage), and 94% of descriptions have none: those rows skip the
 * classification's subquery. Measured 2026-10-26 with production's 19,113
 * descriptions loaded locally: count(*) under this predicate 55 ms, under the
 * classification alone 82 ms. An ASCII-only test in front of it
 * (octet_length = length) measured 55 → 54 ms and was not kept: what costs is
 * classifying the 1,132 CJK-bearing rows, and nothing short of the class
 * itself says which of them are Chinese.
 *
 * ponytail: so a listing with no words classifies every CJK-bearing row on
 * every request. Measured 2026-10-27 at production's 19,113 rows, with the
 * counts fenced (summaryLanguage): browse count 87 → 121 ms, the home page's
 * feed (listPackages, 10 rows) 124 ms, its type counts (countVisibleByType)
 * 125 ms — 138, 144 and 147 ms before the fence
 * (docs/analysis/agentdock-phase60-63-visual-and-language.md §14,
 * agentdock-phase65-language-sql-optimization.md §8). A search with words
 * classifies only its matches (search.ts, searchWhere). The upgrade is the
 * STORED generated column named above, which turns this into an indexed
 * equality — a migration to approve. Revisit when the browse count passes
 * 200 ms, about 32k listed rows at this rate.
 */
export function visibleLanguage(hidden: readonly CjkLanguage[]): SQL<boolean> {
  // `not in ()` is a syntax error, and an emptied policy hides nothing.
  if (hidden.length === 0) return sql<boolean>`true`;
  return sql<boolean>`(${packageTable.summary} is null
    or ${packageTable.summary} !~ ${`[${HAN}${KANA}${HANGUL}]`}
    or coalesce(${SUMMARY_LANGUAGE}, '') not in (${sql.join(
      hidden.map((l) => sql`${l}`),
      sql`, `,
    )}))`;
}
