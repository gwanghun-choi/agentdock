import type { CapabilityFindingView } from '@/db/queries/capabilities';

/**
 * The one place a reader can see hidden content: an HTML comment the
 * renderer above drops entirely, or an invisible codepoint that survives
 * into the rendered body with no visible form. Both facts are proven, not
 * merely asserted, by SkillBody.test.tsx's own two hidden-content
 * assertions — see the comment above them, and 04-CONTEXT.md's Reference E.
 *
 * Pure, following JobPanel.tsx's own doc: takes an array of plain rows,
 * holds nothing and reaches nothing — no database, no router, no server
 * function. That is what lets this be asserted in a suite that runs where
 * there is neither.
 *
 * `permalinkFor` is a function prop rather than an import of
 * `permalinkAtLine` from `@/db/queries/packages`, for the same reason
 * JobPanel.tsx takes `retry` as a ReactNode rather than importing a server
 * action: importing a query module pulls `@/db/client` in at module load
 * (it constructs a postgres.js client from `parseEnv()` at the top of the
 * file), and this component's own test suite would stop running without a
 * database, which is the whole point of the split. The page already
 * computes this permalink for the generic "Observed in this file" list;
 * this component reuses the same function rather than a duplicate of it.
 *
 * Sentinel substitution already happened in the analyzer
 * (src/analyze/hidden.ts's sentinelize) — this component performs no
 * substitution of its own. `evidenceText` is rendered exactly as stored,
 * inside a bare JSX text node, so React's default escaping is the only
 * sanitizer involved: no Markdown parser, no dangerouslySetInnerHTML, no
 * rehype-raw anywhere in this file. check-boundaries.mjs's no-raw-html rule
 * fails CI on either shortcut, so the wrong answer is mechanically
 * unavailable here, not merely discouraged.
 *
 * Renders nothing when there is nothing to show: the "not analyzed" and
 * "not detected" honest-absence states belong to the general capability
 * panel, not to this one, so they are not duplicated here.
 */
export function HiddenContentPanel({
  findings,
  permalinkFor,
}: {
  findings: CapabilityFindingView[];
  permalinkFor: (finding: CapabilityFindingView) => string;
}) {
  if (findings.length === 0) return null;

  return (
    <>
      <h2>Hidden Content</h2>
      <p className="muted">
        Content present in this file that the rendered body above does not show — for a comment,
        because the renderer drops it; for an invisible character, because it has no visible form.
        Named here rather than removed.
      </p>
      <ul className="notes muted">
        {findings.map((f) => (
          <li key={f.id}>
            <a href={permalinkFor(f)} rel="noopener noreferrer" target="_blank">
              {f.sourcePath}
              {f.startLine !== null ? `:${f.startLine}` : ''}
            </a>{' '}
            — {f.summary}
            {f.evidenceText ? (
              <>
                {': '}
                <code>{f.evidenceText}</code>
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
