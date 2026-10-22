/**
 * Credential-shaped values blanked out of text a page shows as configuration:
 * an MCP server's command, arguments and URL, a hook's command.
 *
 * The values come from public repositories, so this hides nothing from anyone
 * who opens the linked file. It exists so AgentDock never becomes the second,
 * one-click-copyable place a committed token lives — the rule the detectors
 * already follow for env values (src/detect/mcp.ts stores key names only).
 *
 * A heuristic with a known ceiling, by construction: it blanks what LOOKS like
 * a credential (a value after a key-ish name, a bearer header, a URL password,
 * a well-known token prefix), so it can miss an unlabelled secret and can blank
 * an innocent value whose flag happens to be called `--key`. Erring toward
 * blanking is the side that costs a reader one click on the source link.
 * A `${VAR}` or `$VAR` reference is kept: it names a variable, not a value.
 */
export const REDACTED = '<redacted>';

// A name that labels a credential. Matched against a flag, a query parameter
// or an assignment's left side, lowercased.
const SENSITIVE_NAME =
  /(key|token|secret|passw|pwd|credential|signature|cookie|session|^auth$|^authorization$|^sig$|^bearer$)/;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name.toLowerCase().replace(/^-+/, ''));
}

const isReference = (value: string) => /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value);

// Prefixes their issuers document as fixed: GitHub, OpenAI/Anthropic-style
// `sk-`, Stripe, Slack, AWS access key ids, Google API keys, GitLab.
const TOKEN_PREFIX =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b/g;

/** One string, any shape: a command line, a URL, an argument. */
export function redactSecrets(text: string): string {
  return (
    text
      // scheme://user:password@host — the password, whatever the scheme.
      .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi, `$1:${REDACTED}@`)
      // Authorization: Bearer x / Basic x, quoted or not.
      .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`)
      // name=value and name: value, in a query string, an env prefix or a header.
      .replace(
        /([A-Za-z0-9_.-]+)(=|:(?!\/\/)\s*)("[^"]*"|'[^']*'|[^\s&"',;]+)/g,
        (whole, name: string, sep: string, value: string) => {
          const bare = value.replace(/^["']|["']$/g, '');
          const keep =
            !isSensitiveName(name) ||
            bare === '' ||
            bare === REDACTED ||
            isReference(bare) ||
            // A header's scheme word; the Bearer rule above blanked what follows it.
            /^(Bearer|Basic|Token)$/.test(bare);
          return keep ? whole : `${name}${sep}${REDACTED}`;
        },
      )
      // `--flag value`, the value as the next word.
      .replace(
        /(--?[A-Za-z0-9_-]+)(\s+)("[^"]*"|'[^']*'|[^\s"'-][^\s]*)/g,
        (whole, flag, gap, value) =>
          isSensitiveName(flag) && !isReference(value.replace(/^["']|["']$/g, ''))
            ? `${flag}${gap}${REDACTED}`
            : whole,
      )
      .replace(TOKEN_PREFIX, REDACTED)
  );
}

/**
 * An argument vector. Same rules as redactSecrets per element, plus the one
 * case a per-element pass cannot see: `["--api-key", "value"]`, where the flag
 * and its value are two elements. Non-strings pass through untouched.
 */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg, i) => {
    if (typeof arg !== 'string') return arg;
    const prev = args[i - 1];
    if (
      typeof prev === 'string' &&
      /^--?[A-Za-z0-9_-]+$/.test(prev) &&
      isSensitiveName(prev) &&
      !arg.startsWith('-') &&
      !isReference(arg)
    ) {
      return REDACTED;
    }
    return redactSecrets(arg);
  });
}
