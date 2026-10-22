import { Fragment } from 'react';

/**
 * The delimiters PostgreSQL's ts_headline wraps a matched word in, for the
 * search results (src/db/queries/search.ts, `marked`). Control characters,
 * because no name or summary needs them: the query strips both from the stored
 * text before ts_headline sees it, so every one in its output was put there by
 * ts_headline.
 *
 * Kept here, beside the one renderer of them, rather than in search.ts: that
 * module opens the database client as it loads, and this one has to be
 * testable without it.
 */
export const MARK_OPEN = '\u0002';
export const MARK_CLOSE = '\u0003';

export type Segment = { text: string; marked: boolean };

const strip = (value: string) => value.replaceAll(MARK_OPEN, '').replaceAll(MARK_CLOSE, '');

/**
 * Splits a delimited string into plain and marked runs. Anything other than
 * strictly alternating open/close pairs is not what ts_headline writes, so it
 * comes back as one plain run with the delimiters removed — the text, never a
 * guess at where a mark was.
 */
export function markedSegments(value: string): Segment[] {
  const out: Segment[] = [];
  let marked = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== MARK_OPEN && ch !== MARK_CLOSE) continue;
    if ((ch === MARK_OPEN) === marked) return [{ text: strip(value), marked: false }];
    if (i > start) out.push({ text: value.slice(start, i), marked });
    marked = !marked;
    start = i + 1;
  }
  if (marked) return [{ text: strip(value), marked: false }];
  if (start < value.length) out.push({ text: value.slice(start), marked: false });
  return out;
}

/**
 * `text` with every case-insensitive occurrence of `needle` delimited — the
 * path test search.ts runs for a query containing '/' (`lower(source_path)
 * LIKE '%' || lower(q) || '%'`, with `%` and `_` escaped to literals), so the
 * mark lands where that test matched. A string whose lowercase form changes
 * length (a few non-ASCII letters do) is returned unmarked rather than marked
 * at shifted offsets.
 */
export function markSubstring(text: string, needle: string): string {
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  if (n === '' || hay.length !== text.length) return text;
  let out = '';
  let from = 0;
  for (let at = hay.indexOf(n); at !== -1; at = hay.indexOf(n, from)) {
    out += `${text.slice(from, at)}${MARK_OPEN}${text.slice(at, at + n.length)}${MARK_CLOSE}`;
    from = at + n.length;
  }
  return out + text.slice(from);
}

/**
 * Renders `value`'s marked runs as <mark> and the rest as text nodes. React
 * escapes both, and no markup string is built anywhere on this path: a summary
 * holding `<b>` renders those three characters. With no delimited value (no
 * query, or a null column), `plain` is rendered as it is.
 */
export function Marked({ value, plain }: { value?: string | null; plain: string }) {
  if (!value) return plain;
  return markedSegments(value).map((s, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: runs have no identity but their position
    s.marked ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>,
  );
}
