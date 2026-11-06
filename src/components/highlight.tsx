import type { ReactNode } from 'react';

/**
 * Colour for a code block, on the server, as text nodes in spans: nothing here ever becomes
 * markup, and no client code ships. A highlighter package is a grammar for hundreds of languages
 * to colour what these bodies hold, which is shell, JSON, YAML and a little script. It marks only
 * what one line can prove, so a language it does not know stays plain rather than wrong.
 *
 * ponytail: a pattern per family, no parsing. A string spanning lines or a heredoc goes uncoloured
 * after its first line. A real grammar (shiki, server-side) if readers ask for a language here.
 *
 * Every alternative stops at a line's end and a long line is skipped (MAX_LINE), so a hostile
 * file has no pattern to hold open.
 */
type Family = 'shell' | 'json' | 'yaml' | 'script';

const FAMILY: Record<string, Family> = {
  bash: 'shell',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  console: 'shell',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  js: 'script',
  jsx: 'script',
  javascript: 'script',
  ts: 'script',
  tsx: 'script',
  typescript: 'script',
  py: 'script',
  python: 'script',
  go: 'script',
  rust: 'script',
};

const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/.source;
const NUMBER = /\b\d[\d_.]*\b/.source;
const KEYWORDS =
  'import|from|export|default|function|return|const|let|var|if|else|for|while|class|def|async|await|new|type|interface|fn|func|package|try|catch|except|with|as|in|yield|true|false|null|None|True|False';

const PATTERNS: Record<Family, RegExp> = {
  shell: new RegExp(
    `(?<comment>(?:^|(?<=\\s))#[^\\n]*)|(?<string>${STRING})|(?<cmd>^[ \\t]*(?:\\$ )?[\\w./~-]+)|(?<flag>(?<=\\s)--?[\\w-]+)|(?<key>\\$\\{?\\w+\\}?)`,
    'gm',
  ),
  json: new RegExp(
    `(?<key>"(?:[^"\\\\\\n]|\\\\.)*"(?=\\s*:))|(?<string>${STRING})|(?<number>-?${NUMBER})|(?<keyword>\\b(?:true|false|null)\\b)`,
    'g',
  ),
  yaml: new RegExp(
    `(?<comment>(?:^|(?<=\\s))#[^\\n]*)|(?<key>^[ \\t-]*[\\w.-]+(?=:))|(?<string>${STRING})|(?<number>(?<=[\\s:])${NUMBER}$)|(?<keyword>\\b(?:true|false|null)\\b)`,
    'gm',
  ),
  script: new RegExp(
    `(?<comment>\\/\\/[^\\n]*|\\/\\*[^\\n]*|(?:^|(?<=\\s))#[^\\n]*)|(?<string>${STRING}|\`[^\`\\n]*\`)|(?<keyword>\\b(?:${KEYWORDS})\\b)|(?<number>${NUMBER})`,
    'gm',
  ),
};

export function languageFamily(language: string | undefined): Family | null {
  const name = language?.toLowerCase();
  // An author writes this word: `constructor` is on every object.
  return name && Object.hasOwn(FAMILY, name) ? FAMILY[name] : null;
}

// Past this a line is data, not code, and stays plain. It is also what keeps a hostile file cheap:
// a quote with no partner rescans its line, which is quadratic in the line and nothing else
// (32 KB of `\\"` on one line, unbounded: 959 ms. Bounded: highlight.test.tsx).
const MAX_LINE = 2000;

export function highlight(text: string, language: string | undefined): ReactNode[] {
  const family = languageFamily(language);
  if (!family) return [text];
  const out: ReactNode[] = [];
  let plainFrom = 0;
  let lineStart = 0;
  for (const line of text.split('\n')) {
    if (line.length <= MAX_LINE) {
      for (const match of line.matchAll(PATTERNS[family])) {
        if (match[0] === '') continue;
        const groups = match.groups ?? {};
        const kind = Object.keys(groups).find((name) => groups[name] !== undefined);
        const at = lineStart + match.index;
        if (at > plainFrom) out.push(text.slice(plainFrom, at));
        out.push(
          <span className={`tk-${kind}`} key={at}>
            {match[0]}
          </span>,
        );
        plainFrom = at + match[0].length;
      }
    }
    lineStart += line.length + 1;
  }
  if (plainFrom < text.length) out.push(text.slice(plainFrom));
  return out;
}
