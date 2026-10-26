import type { SummaryLanguage } from '@/db/queries/language';

/**
 * The words for SUMMARY_LANGUAGE's classes (src/db/queries/language.ts), which
 * say what writing system a description is in — never that it was translated,
 * and never what an artifact does. Presentation only, like typeFilters.ts.
 *
 * `latin` is "Latin alphabet", not "English": the characters cannot tell
 * English from Vietnamese written without diacritics, and about 1.2% of these
 * descriptions are not English (measured 2026-10-26).
 */
export const LANGUAGE_LABELS: Record<SummaryLanguage, string> = {
  latin: 'Latin alphabet',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  mixed: 'Mixed languages',
  other: 'Other scripts',
  unknown: 'Unknown',
};

/**
 * The `lang` attribute for a description, where the script names one language.
 * It is what makes a screen reader switch voice and what picks the Chinese,
 * Japanese or Korean glyph for a Han character the three write differently;
 * the page itself is `lang="en"`. Nothing for `latin`, `mixed` and the rest — a
 * wrong `lang` is worse than the page's own.
 */
export function htmlLang(language: SummaryLanguage | null | undefined): string | undefined {
  return language === 'zh' || language === 'ja' || language === 'ko' ? language : undefined;
}

/** The classes a row or a detail page names: the ones a reader of English would not expect. */
export function languageNote(language: SummaryLanguage | null | undefined): string | null {
  return language && language !== 'latin' && language !== 'unknown'
    ? LANGUAGE_LABELS[language]
    : null;
}
