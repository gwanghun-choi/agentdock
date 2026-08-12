import Link from 'next/link';
import { z } from 'zod';
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, SearchIcon } from '@/components/Icon';
import { PackageRows } from '@/components/PackageRows';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import {
  ARTIFACT_TYPE_IDS,
  CAPABILITY_FILTER_IDS,
  countSearchResults,
  normalizeQuery,
  SEARCH_CAPS,
  type SearchFilters,
  searchPackages,
} from '@/db/queries/search';
import { log } from '@/log';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Artifacts — AgentDock' };

/**
 * Coerced through a bounded schema with a fallback, never through Number().
 * A repeated query parameter arrives as an array, and Number(['1','2']) is
 * NaN — which reaches the query as an offset that silently returns nothing.
 * Follows skills/page.tsx's own idiom, extended to SEARCH_CAPS.maxPage so
 * the route, the query and the paginator read the same bound.
 */
const pageParam = z.coerce.number().int().min(1).max(SEARCH_CAPS.maxPage).catch(1);

/**
 * Type and capability labels, decoupled from the internal enum ids (D-26):
 * the ids live in search.ts's closed arrays so a route can validate against
 * them; the labels live here, beside the markup that renders them, matching
 * the seeded artifact_type.label values the detail page's own TYPE_LABELS
 * already use.
 */
const TYPE_FILTER_LABELS: Record<(typeof ARTIFACT_TYPE_IDS)[number], string> = {
  skill: 'Agent Skills',
  plugin: 'Claude Code Plugins',
  mcp_server: 'MCP Servers',
  command: 'Slash Commands',
  hook: 'Hook Configurations',
};

/**
 * Phase 4's observation vocabulary (CapabilityPanel.tsx's own CATEGORY_LABELS
 * register), never a verdict word (D-28). check-boundaries.mjs rule six
 * scans every new sentence in this file for VERDICT_WORDS — run it after
 * touching any of this copy.
 */
const CAPABILITY_FILTER_LABELS: Record<(typeof CAPABILITY_FILTER_IDS)[number], string> = {
  no_network: 'No network request observed',
  no_shell: 'No Bash grant declared',
  no_scripts: 'No bundled script files',
};

/**
 * D-38/D-39: the corpus is not the ecosystem, said on every result page
 * (zero-result and non-empty alike), grounded in Phase 5's measured facts —
 * 16 repositories, two of them 69% of artifacts, no GitHub-wide crawl.
 */
// The repository count used to be written into this sentence as "16
// repositories". It was measured during Phase 5 and is already wrong in
// production, where the corpus has grown — a hardcoded count is a claim that
// rots silently. The scope statement is true at any size, which is what it is
// for; the exact totals are already on the page beside the results.
const SCOPE_SENTENCE =
  `AgentDock indexes public, non-fork, non-archived repositories with at least ` +
  `${MIN_REPOSITORY_STARS} GitHub stars, discovered from a registry, a curated seed list ` +
  'and topic search. It is not a complete index of GitHub.';

const NO_FILTERS: SearchFilters = { types: [], capabilities: [] };

/** A native <select name="type"> submits at most one value. Dropped when it
 * is not one of the five listable ids (unmatched values reach search.ts's
 * own validation too, but the route needs the validated value to know what
 * to mark selected in the re-rendered form). */
function parseTypeFilter(raw: string | string[] | undefined): (typeof ARTIFACT_TYPE_IDS)[number][] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && (ARTIFACT_TYPE_IDS as readonly string[]).includes(value)
    ? [value as (typeof ARTIFACT_TYPE_IDS)[number]]
    : [];
}

/** Repeated `cap` parameters arrive as an array; a single one arrives as a
 * bare string. Unmatched values are dropped. */
function parseCapabilityFilter(
  raw: string | string[] | undefined,
): (typeof CAPABILITY_FILTER_IDS)[number][] {
  const values = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  return values.filter((c): c is (typeof CAPABILITY_FILTER_IDS)[number] =>
    (CAPABILITY_FILTER_IDS as readonly string[]).includes(c),
  );
}

/**
 * The one URL builder every link on this page uses: Previous, Next, and
 * both empty-state links. Four hand-built template strings is four chances
 * to drop `q` (or now, a filter) from one of them while the others keep it
 * — this is the single place that re-emits the whole state, so pagination
 * and filtering cannot silently lose each other (D-35/D-36).
 */
function hrefFor(q: string, page: number, filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  for (const t of filters.types) params.set('type', t);
  for (const c of filters.capabilities) params.append('cap', c);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/artifacts?${qs}` : '/artifacts';
}

function appliedFilterLabels(filters: SearchFilters): string[] {
  const labels: string[] = [];
  for (const t of filters.types) {
    const label = TYPE_FILTER_LABELS[t as (typeof ARTIFACT_TYPE_IDS)[number]];
    if (label) labels.push(label);
  }
  for (const c of filters.capabilities) {
    const label = CAPABILITY_FILTER_LABELS[c as (typeof CAPABILITY_FILTER_IDS)[number]];
    if (label) labels.push(label);
  }
  return labels;
}

/**
 * Browse-and-search over the listing-visible corpus. `q` empty or absent
 * browses (D-17/D-18, handled entirely inside searchPackages); `q` present
 * searches, ranked per D-12. Type and capability filters narrow either mode
 * (DIS-05/DIS-06), applied in SQL inside the identical shared predicate
 * searchPackages and countSearchResults both call.
 *
 * A plain GET form with native controls, no client component: it works
 * with JavaScript disabled, and it puts `q`, `type` and `cap` all in the
 * URL where D-35 requires them. The form omits `page` entirely, which
 * resets to page 1 on every filter change by construction rather than by a
 * reset rule.
 */
export default async function ArtifactsPage({
  searchParams,
}: {
  // Written by hand rather than taken from the generated route-typing
  // helper, which needs types that exist only after a build.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = normalizeQuery(sp.q);
  const page = pageParam.parse(sp.page);
  const offset = (page - 1) * SEARCH_CAPS.pageSize;

  const selectedTypes = parseTypeFilter(sp.type);
  const selectedCapabilities = parseCapabilityFilter(sp.cap);
  const filters: SearchFilters = { types: selectedTypes, capabilities: selectedCapabilities };
  const hasQuery = q !== '';
  const hasFilters = selectedTypes.length > 0 || selectedCapabilities.length > 0;

  // The route emits exactly one log line per request, wrapping BOTH queries
  // — searchPackages is react.cache-wrapped, so a call from inside it would
  // emit either zero or two lines depending on cache behaviour, and the
  // route is the one place that knows the request happened exactly once.
  const start = Date.now();
  const [items, total] = await Promise.all([
    searchPackages({ q, filters, limit: SEARCH_CAPS.pageSize, offset }),
    countSearchResults({ q, filters }),
  ]);
  const durationMs = Date.now() - start;

  log({
    event: 'search',
    query: q,
    types: selectedTypes,
    capabilities: selectedCapabilities,
    page,
    resultCount: items.length,
    totalCount: total,
    durationMs,
  });

  const last = Math.max(1, Math.ceil(total / SEARCH_CAPS.pageSize));

  const searchForm = (
    // No role="search": the label names the field, and the native <search>
    // element is the semantic answer the linter asks for — but wrapping a GET
    // form in one changes nothing a reader or a screen reader gets here.
    <form method="get" action="/artifacts" className="search">
      <label htmlFor="q">Search artifacts</label>
      <div className="search-row">
        <span className="field">
          <SearchIcon />
          <input
            id="q"
            name="q"
            type="search"
            placeholder="Name, description, repository or path"
            defaultValue={q}
            maxLength={SEARCH_CAPS.maxQueryLength}
          />
        </span>
        <button type="submit">Search</button>
      </div>
      <div className="facets">
        <label htmlFor="type">Type</label>
        <select id="type" name="type" defaultValue={selectedTypes[0] ?? ''}>
          <option value="">All types</option>
          {ARTIFACT_TYPE_IDS.map((id) => (
            <option key={id} value={id}>
              {TYPE_FILTER_LABELS[id]}
            </option>
          ))}
        </select>
        <fieldset>
          <legend className="muted">Capability</legend>
          {CAPABILITY_FILTER_IDS.map((id) => (
            <label key={id}>
              <input
                type="checkbox"
                name="cap"
                value={id}
                defaultChecked={selectedCapabilities.includes(id)}
              />{' '}
              {CAPABILITY_FILTER_LABELS[id]}
            </label>
          ))}
        </fieldset>
      </div>
    </form>
  );

  // D-08: filters describe an observation, never a completeness claim.
  const searchControls = (
    <>
      {searchForm}
      <p className="notice">
        <InfoIcon />
        <span>
          These filters describe what AgentDock observed while reading the files, not everything an
          artifact can do.
        </span>
      </p>
    </>
  );

  const nextSteps = (
    <p className="actions">
      <Link className="btn btn-quiet" href={hrefFor(q, 1, NO_FILTERS)}>
        Clear filters
      </Link>
      <Link className="btn btn-quiet" href="/artifacts">
        Browse all artifacts
      </Link>
    </p>
  );

  const pageHead = (
    <div className="page-head">
      <h1>Artifacts</h1>
      <p className="muted">{SCOPE_SENTENCE}</p>
    </div>
  );

  // Corpus empty (browse mode, nothing indexed at all, no filter applied).
  // Checked on q === '' and no filters specifically: a query or filter that
  // happens to match nothing is a different fact (branch 3, below) than
  // "AgentDock holds no artifacts yet".
  if (!hasQuery && !hasFilters && total === 0) {
    return (
      <>
        {pageHead}
        {searchControls}
        <div className="empty">
          {/* No "submit a repository" link any more: there is nothing to submit
              to. The honest next step is the policy that decides what arrives
              here, which the home page states. */}
          <p className="muted">
            No artifacts indexed yet. The scheduled sync fills this the next time it runs.
          </p>
          <p className="actions">
            <Link className="btn btn-quiet" href="/">
              How a repository gets indexed
            </Link>
          </p>
        </div>
      </>
    );
  }

  // A page past the end has no range to report. Reporting one anyway prints
  // "Showing 26-25 of 18", which is how a paginator tells its first lie.
  if (total > 0 && items.length === 0) {
    return (
      <>
        {pageHead}
        {searchControls}
        <div className="empty">
          <p className="muted">
            There is no page {page}. This result set has {total} artifacts.
          </p>
          <p className="actions">
            <Link className="btn btn-quiet" href={hrefFor(q, 1, filters)}>
              <ArrowLeftIcon /> Back to the first page
            </Link>
          </p>
        </div>
      </>
    );
  }

  // Zero search/filter results — structurally distinct from both branches
  // above. States the fact, offers next steps, never claims non-existence
  // (D-38), and discloses corpus scope (D-39).
  if (items.length === 0) {
    const filterLabels = appliedFilterLabels(filters);
    return (
      <>
        {pageHead}
        {searchControls}
        <div className="empty">
          <p>
            No artifacts matched {q ? `"${q}"` : 'the applied filters'}
            {filterLabels.length > 0 ? ` (${filterLabels.join(', ')})` : ''}.
          </p>
          {/* Never "does not exist" — the corpus is not the ecosystem (D-38). */}
          <p className="muted">
            AgentDock has not indexed a match. That is not the same as the artifact not existing.
          </p>
          {nextSteps}
        </div>
      </>
    );
  }

  // The trigram fallback fired (DIS-04, 06-04): full-text found nothing —
  // countSearchResults runs the identical predicate as the full-text branch
  // above, so total === 0 here is authoritative for "no exact match" — but
  // searchPackages' own zero-result branch returned trigram rows instead of
  // an empty array. States plainly that these are close matches, never
  // exact ones (T-06-29, D-42's "tell the reader what happened"). No "of
  // {total}" claim and no pager: countSearchResults never runs the trigram
  // predicate, so total does not describe this branch and would be a lie.
  if (hasQuery && total === 0 && items.length > 0) {
    return (
      <>
        {pageHead}
        {searchControls}
        {/* DIS-04 made legible: the heading states the miss, the subheading
            names what is being shown instead. Never a bare "0 results". */}
        <div className="result-bar">
          <p>
            <strong>No exact match for &quot;{q}&quot;</strong>
            <br />
            <span className="muted">Close matches by name and summary</span>
          </p>
        </div>
        <PackageRows items={items} />
      </>
    );
  }

  return (
    <>
      {pageHead}
      {searchControls}
      <div className="result-bar">
        <p className="muted">
          {q
            ? `Showing ${offset + 1}–${offset + items.length} of ${total} for "${q}"`
            : `Showing ${offset + 1}–${offset + items.length} of ${total}`}
        </p>
      </div>
      <PackageRows items={items} />
      <nav className="pager" aria-label="Pagination">
        {page > 1 ? (
          <Link href={hrefFor(q, page - 1, filters)} rel="prev">
            <ArrowLeftIcon /> Previous
          </Link>
        ) : null}
        {page < last ? (
          <Link href={hrefFor(q, page + 1, filters)} rel="next">
            Next <ArrowRightIcon />
          </Link>
        ) : null}
        <span className="muted">
          Page {page} of {last}
        </span>
      </nav>
    </>
  );
}
