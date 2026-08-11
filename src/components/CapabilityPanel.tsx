import type { CapabilityFindingView } from '@/db/queries/capabilities';

/**
 * Plural-aware labels for the per-category counts on each heading. Only the
 * categories this panel ever renders need an entry — `hidden_content` is
 * excluded upstream (it has its own panel, HiddenContentPanel.tsx) and
 * `file_inventory` is never assigned to a Finding's own category (it names
 * the Files table, not a finding — src/analyze/types.ts's own doc).
 */
const CATEGORY_LABELS: Record<string, [string, string]> = {
  declared: ['declared grant', 'declared grants'],
  package_install: ['install directive', 'install directives'],
  network_request: ['network request', 'network requests'],
  external_reference: ['outbound reference', 'outbound references'],
  remote_execution: ['remote-execution pattern', 'remote-execution patterns'],
};

function categoryLabel(category: string, n: number): string {
  const pair = CATEGORY_LABELS[category];
  if (!pair) return `${n} ${category}`;
  return `${n} ${n === 1 ? pair[0] : pair[1]}`;
}

/**
 * "3 install directives, 1 outbound reference" — never a total across
 * categories. A summed number is a score with one term (CONTEXT.md decision
 * 3), so this function deliberately has no path that adds the entries
 * together; it only ever joins the per-category strings with a comma.
 */
function countsByCategory(rows: CapabilityFindingView[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  return [...counts.entries()].map(([category, n]) => categoryLabel(category, n)).join(', ');
}

/**
 * One section's body: three states, keyed on analyzedAt first and the
 * section's own row count second — never a count alone, because a
 * package_version nobody has analyzed yet and one that was analyzed and
 * found nothing are different facts (CAP-11) and a row count cannot tell
 * them apart.
 */
function SectionBody({
  rows,
  analyzedAt,
  declared,
  permalinkFor,
}: {
  rows: CapabilityFindingView[];
  analyzedAt: Date | null;
  declared: boolean;
  permalinkFor: (finding: CapabilityFindingView) => string;
}) {
  if (analyzedAt === null) return <p className="muted">not analyzed</p>;
  if (rows.length === 0) return <p className="muted">not detected</p>;

  return (
    <ul className="notes muted">
      {rows.map((f) =>
        declared ? (
          // The grant text verbatim, with no line link: a multi-token
          // frontmatter field (or a coarse Bash(*) grant) has no single
          // useful line to point at — inventing one would produce a
          // permalink that points at the right file and the wrong claim.
          <li key={f.id}>
            <code>{f.signal}</code> — {f.summary}
          </li>
        ) : (
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
        ),
      )}
    </ul>
  );
}

/**
 * Two channels, rendered where there is neither a database nor a browser.
 *
 * Pure, following JobPanel.tsx's and HiddenContentPanel.tsx's own doc: it
 * takes an array of plain rows and a permalink function, holds nothing and
 * reaches nothing. `permalinkFor` is a function prop rather than an import of
 * permalinkAtLine, for the same reason HiddenContentPanel.tsx takes one:
 * importing @/db/queries/packages pulls @/db/client in at module load, and
 * this component's own test suite would stop running without a database.
 *
 * `findings` is expected to already exclude hidden_content — the page splits
 * that category out for HiddenContentPanel before calling this component, so
 * a hidden-content row is never double-rendered.
 *
 * Two sections, never one list: `category === 'declared'` is a fact about
 * what the author wrote; every other category is a fact about what the
 * text says. A `Bash(git:*)` grant and a `curl` in prose are different kinds
 * of evidence, and merging them into one list erases exactly the distinction
 * that makes the declared signal worth more (CONTEXT.md decision, Reference
 * A). Neither section reads the other's rows to decide its own absence
 * state — the "not analyzed" / "not detected" split is per section, keyed on
 * the same analyzedAt, so an artifact with findings in one category only
 * still reports the other honestly as "not detected" rather than silently
 * inheriting the first section's non-empty state.
 *
 * Counts live on the section headings and nowhere else. No stat block, no
 * icon, no colour keyed to a count, and — the one absolute rule — no total
 * summed across categories anywhere in this file. A stat block is one CSS
 * change from a dashboard, and a summed number is a score with one term.
 *
 * The overflow finding an overflowing analyzer emits (src/analyze/run.ts,
 * signal: 'cap') is not special-cased here. It is an ordinary row in its own
 * category with startLine null and evidenceText null, and this component
 * renders it exactly the way it renders any other observed row — the
 * honesty is stored in the finding itself, not recomputed by the panel that
 * displays it.
 *
 * Every value below is a JSX text node React escapes by default. Nothing
 * here is parsed as Markdown, nothing reaches for dangerouslySetInnerHTML or
 * rehype-raw, and there is no sanitizer to import because nothing is parsed
 * as markup in the first place — check-boundaries.mjs's no-raw-html rule
 * fails CI on either shortcut, so the wrong answer is mechanically
 * unavailable here, not merely discouraged.
 */
export function CapabilityPanel({
  findings,
  analyzedAt,
  permalinkFor,
}: {
  findings: CapabilityFindingView[];
  analyzedAt: Date | null;
  permalinkFor: (finding: CapabilityFindingView) => string;
}) {
  const declaredFindings = findings.filter((f) => f.category === 'declared');
  const observedFindings = findings.filter((f) => f.category !== 'declared');

  return (
    <>
      <h2>
        Declared by the author
        {declaredFindings.length > 0 ? ` — ${countsByCategory(declaredFindings)}` : ''}
      </h2>
      <SectionBody
        rows={declaredFindings}
        analyzedAt={analyzedAt}
        declared={true}
        permalinkFor={permalinkFor}
      />

      <h2>
        Observed in the file text
        {observedFindings.length > 0 ? ` — ${countsByCategory(observedFindings)}` : ''}
      </h2>
      <SectionBody
        rows={observedFindings}
        analyzedAt={analyzedAt}
        declared={false}
        permalinkFor={permalinkFor}
      />
    </>
  );
}
