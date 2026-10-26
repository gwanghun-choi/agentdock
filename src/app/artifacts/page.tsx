import Link from 'next/link';
import { z } from 'zod';
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, SearchIcon } from '@/components/Icon';
import { LANGUAGE_LABELS } from '@/components/language';
import { PackageRows } from '@/components/PackageRows';
import {
  defaultSort,
  pageWindow,
  searchHref,
  toggleCapability,
  withLanguage,
  withSort,
  withType,
} from '@/components/searchState';
import { TYPE_FILTER_LABELS as SHARED_TYPE_FILTER_LABELS } from '@/components/typeFilters';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import {
  ARTIFACT_TYPE_IDS,
  CAPABILITY_FILTER_IDS,
  countSearchResults,
  LANGUAGE_FILTER_IDS,
  normalizeQuery,
  SEARCH_CAPS,
  SEARCH_SORTS,
  type SearchFilters,
  type SearchSort,
  searchMode,
  searchPackages,
} from '@/db/queries/search';
import { log } from '@/log';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

/**
 * One indexable URL per type, and none per query. A search, a capability
 * filter or a page number is a combination of parameters a crawler could
 * enumerate without end, and each is the same rows as some type listing; those
 * render with `noindex` and are still followed, so the detail pages they link
 * to are reached. Read from the parameters alone — no query runs for this.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = normalizeQuery(sp.q);
  const [type] = parseTypeFilter(sp.type);
  const varied =
    q !== '' ||
    sp.cap !== undefined ||
    sp.lang !== undefined ||
    sp.sort !== undefined ||
    pageParam.parse(sp.page) > 1;
  const subject = type ? TYPE_FILTER_LABELS[type] : 'Artifacts';
  const title = q ? `“${q}” in ${subject} — AgentDock` : `${subject} — AgentDock`;
  const description = type
    ? `${TYPE_FILTER_LABELS[type]} AgentDock read from public GitHub repositories, each linked to the commit it was read at.`
    : 'Browse and search the agent artifacts AgentDock read from public GitHub repositories.';
  return {
    title,
    description,
    // As on the repository page: otherwise the card is the layout's.
    openGraph: { title, description, type: 'website', siteName: 'AgentDock' },
    twitter: { card: 'summary', title, description },
    ...(varied ? { robots: { index: false, follow: true } } : {}),
  };
}

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
 * them; the labels live beside the markup that renders them, matching the
 * seeded artifact_type.label values the detail page's own TYPE_LABELS use.
 *
 * The type labels moved to `@/components/typeFilters` so the search launcher —
 * which the root layout renders on every route, and which therefore must not
 * pull `@/db/client` into its module graph — can render the same five chips
 * without a second copy of the list.
 *
 * This line is what keeps the two honest. Annotating the shared object as a
 * `Record` keyed by `ARTIFACT_TYPE_IDS` means a type added to search.ts and not
 * to that module stops the build here, in the one file that can see both.
 */
const TYPE_FILTER_LABELS: Record<(typeof ARTIFACT_TYPE_IDS)[number], string> =
  SHARED_TYPE_FILTER_LABELS;

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

/** As parseTypeFilter: one of LANGUAGE_FILTER_IDS, or none. */
function parseLanguageFilter(
  raw: string | string[] | undefined,
): (typeof LANGUAGE_FILTER_IDS)[number][] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && (LANGUAGE_FILTER_IDS as readonly string[]).includes(value)
    ? [value as (typeof LANGUAGE_FILTER_IDS)[number]]
    : [];
}

/**
 * One of SEARCH_SORTS, or the default for the query. `relevance` without a query
 * is the default instead: every row would rank 0, so it would be `recent` under
 * another name, and the page offers it only beside a query.
 */
function parseSort(raw: string | string[] | undefined, q: string): SearchSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const known = SEARCH_SORTS.find((s) => s === value);
  return known && !(known === 'relevance' && !q) ? known : defaultSort(q);
}

const SORT_LABELS: Record<SearchSort, string> = {
  relevance: 'Relevance',
  recent: 'Recently indexed',
  added: 'Newly added',
  changed: 'Content changed',
  name: 'Name',
};

/**
 * What the three date orders are dates OF, said under the chips while one is
 * applied. Three different clocks, and none of them is the upstream commit's:
 * a reader comparing two dates must be able to tell which one each is.
 */
const SORT_NOTES: Partial<Record<SearchSort, string>> = {
  recent:
    'By when a read last stored each artifact — every read of its repository at a new commit.',
  added:
    'By when AgentDock first indexed each artifact. Not when it was written: a repository read for the first time today brings its old files with it.',
  changed:
    'Artifacts whose content AgentDock has recorded more than once come first, by when it recorded the latest change — not when that change was committed. The rest follow, most recently indexed first.',
};

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

/** Every link on this page goes through searchHref (see searchState.ts), so
 * pagination, sorting and filtering cannot silently lose each other (D-35/D-36). */
function hrefFor(q: string, page: number, filters: SearchFilters, sort?: SearchSort): string {
  return searchHref({
    q,
    types: filters.types,
    languages: filters.languages,
    capabilities: filters.capabilities,
    sort,
    page,
  });
}

/** Each applied filter with the URL of the same search without it. */
function appliedFilters(
  q: string,
  filters: SearchFilters,
  sort?: SearchSort,
): { label: string; href: string }[] {
  const state = {
    q,
    types: filters.types,
    languages: filters.languages,
    capabilities: filters.capabilities,
    sort,
    page: 1,
  };
  const out: { label: string; href: string }[] = [];
  for (const t of filters.types) {
    const label = TYPE_FILTER_LABELS[t as (typeof ARTIFACT_TYPE_IDS)[number]];
    if (label) out.push({ label, href: searchHref(withType(state, null)) });
  }
  for (const l of filters.languages ?? []) {
    const label = LANGUAGE_LABELS[l as (typeof LANGUAGE_FILTER_IDS)[number]];
    if (label)
      out.push({ label: `Description: ${label}`, href: searchHref(withLanguage(state, null)) });
  }
  for (const c of filters.capabilities) {
    const label = CAPABILITY_FILTER_LABELS[c as (typeof CAPABILITY_FILTER_IDS)[number]];
    if (label) out.push({ label, href: searchHref(toggleCapability(state, c)) });
  }
  return out;
}

/**
 * What is narrowing this result set, each with its own way out, beside the
 * count it narrows. The chips above say the same thing, but on a phone they
 * are a scrolled row the reader may not be looking at.
 */
function AppliedFilters({
  q,
  filters,
  sort,
}: {
  q: string;
  filters: SearchFilters;
  sort?: SearchSort;
}) {
  const applied = appliedFilters(q, filters, sort);
  if (applied.length === 0) return null;
  return (
    <ul aria-label="Applied filters" className="applied">
      {applied.map((f) => (
        <li key={f.label}>
          <Link href={f.href}>
            <span className="sr-only">Remove filter: </span>
            {f.label} <span aria-hidden="true">×</span>
          </Link>
        </li>
      ))}
      {applied.length > 1 ? (
        <li>
          <Link className="applied-clear" href={hrefFor(q, 1, NO_FILTERS, sort)}>
            Clear all
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The orders this result set can be read in, as links like the filter chips:
 * the URL is the state, Back undoes it, and it works without JavaScript.
 * Relevance is offered only beside a query (see parseSort).
 */
function SortLinks({ q, filters, sort }: { q: string; filters: SearchFilters; sort: SearchSort }) {
  const state = {
    q,
    types: filters.types,
    languages: filters.languages,
    capabilities: filters.capabilities,
    sort,
    page: 1,
  };
  return (
    <nav aria-label="Sort results" className="facet sort">
      <span className="facet-legend">Sort</span>
      {SEARCH_SORTS.filter((s) => q || s !== 'relevance').map((s) => (
        <Link
          aria-current={s === sort ? 'true' : undefined}
          className="chip"
          href={searchHref(withSort(state, s))}
          key={s}
        >
          {SORT_LABELS[s]}
        </Link>
      ))}
      {SORT_NOTES[sort] ? <span className="muted sort-note">{SORT_NOTES[sort]}</span> : null}
    </nav>
  );
}

/**
 * Previous, the pages around this one, Next. Numbered so a reader can see how
 * far the set goes and jump to its end; `pageWindow` keeps it to at most seven
 * entries, which fits a 320px screen on one line.
 */
function Pager({
  q,
  page,
  last,
  filters,
  sort,
}: {
  q: string;
  page: number;
  last: number;
  filters: SearchFilters;
  sort: SearchSort;
}) {
  if (last <= 1) return null;
  return (
    <nav aria-label="Pagination" className="pager">
      {page > 1 ? (
        <Link href={hrefFor(q, page - 1, filters, sort)} rel="prev">
          <ArrowLeftIcon /> <span className="pager-word">Previous</span>
        </Link>
      ) : null}
      <ol className="pager-pages">
        {pageWindow(page, last).map((p, i) =>
          p === null ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity but its position
            <li aria-hidden="true" className="pager-gap" key={`gap-${i}`}>
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                href={hrefFor(q, p, filters, sort)}
              >
                {p}
              </Link>
            </li>
          ),
        )}
      </ol>
      {page < last ? (
        <Link href={hrefFor(q, page + 1, filters, sort)} rel="next">
          <span className="pager-word">Next</span> <ArrowRightIcon />
        </Link>
      ) : null}
      <span className="muted pager-status">
        Page {page} of {last}
      </span>
    </nav>
  );
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
  const selectedLanguages = parseLanguageFilter(sp.lang);
  const selectedCapabilities = parseCapabilityFilter(sp.cap);
  const filters: SearchFilters = {
    types: selectedTypes,
    capabilities: selectedCapabilities,
    languages: selectedLanguages,
  };
  const hasQuery = q !== '';
  const hasFilters =
    selectedTypes.length > 0 || selectedCapabilities.length > 0 || selectedLanguages.length > 0;
  const sort = parseSort(sp.sort, q);

  // The route emits exactly one log line per request, wrapping BOTH queries
  // — searchPackages is react.cache-wrapped, so a call from inside it would
  // emit either zero or two lines depending on cache behaviour, and the
  // route is the one place that knows the request happened exactly once.
  const start = Date.now();
  const mode = await searchMode({ q, filters });
  const [items, total] = await Promise.all([
    searchPackages({ q, filters, limit: SEARCH_CAPS.pageSize, offset, mode, sort }),
    countSearchResults({ q, filters, mode }),
  ]);
  const durationMs = Date.now() - start;

  log({
    event: 'search',
    query: q,
    types: selectedTypes,
    languages: selectedLanguages,
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
    <form method="get" action="/artifacts">
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
          {/* The shortcut hint is drawn by CSS, as `.field::after`, and is not
              in this markup at all. It was a <kbd aria-hidden="true"> first;
              aria-hidden inside a control is the pattern that makes what a
              screen reader announces differ from what is on screen, and the
              linter is right to refuse it. A pseudo-element is decoration by
              construction — there is no node for the accessibility tree to
              reach — which is exactly what this is. SearchHotkey.tsx makes the
              key work; the field only says that it does. */}
        </span>
        <button type="submit">Search</button>
      </div>
      {/* The applied filters ride along with a new query. Without these a
          reader who picked "Subagents" and then typed a word would lose the
          type on Enter. */}
      {selectedTypes.map((t) => (
        <input key={t} name="type" type="hidden" value={t} />
      ))}
      {selectedLanguages.map((l) => (
        <input key={l} name="lang" type="hidden" value={l} />
      ))}
      {selectedCapabilities.map((c) => (
        <input key={c} name="cap" type="hidden" value={c} />
      ))}
      {/* A chosen order rides along too; the default for the query does not,
          so a new query gets the default for itself. */}
      {sort !== defaultSort(q) ? <input name="sort" type="hidden" value={sort} /> : null}
    </form>
  );

  /*
   * The filters are links, not form controls.
   *
   * They were a radio group and a set of checkboxes inside the GET form, styled
   * as chips. A chip changed its look on click and the results did not change
   * until the reader also pressed Search — measured on the Phase 10 baseline,
   * picking "Subagents" left 162 rows of every type under a highlighted
   * Subagents chip. Submitting on change would need script, and submitting a
   * radio group on each arrow key is the change-of-context-on-input that WCAG
   * 3.2.2 warns about.
   *
   * A link is the native control for "go to this result set": one click, the
   * URL is the state, Back undoes it, and it works with JavaScript off. The
   * hrefs are the URLs the form used to submit — same `type` and `cap`
   * parameters, same parsers on the way back in — and a selected chip links to
   * its own removal. `aria-current` names the applied ones to a screen reader;
   * the look is the same six channels the checked chips used.
   */
  const state = {
    q,
    types: selectedTypes,
    languages: selectedLanguages,
    capabilities: selectedCapabilities,
    sort,
    page: 1,
  };
  const facets = (
    <div className="facets">
      <fieldset className="facet">
        <legend className="facet-legend">Type</legend>
        <div className="facet-chips">
          <Link
            aria-current={selectedTypes.length === 0 ? 'true' : undefined}
            className="chip"
            href={searchHref(withType(state, null))}
          >
            All types
          </Link>
          {ARTIFACT_TYPE_IDS.map((id) => (
            <Link
              aria-current={selectedTypes.includes(id) ? 'true' : undefined}
              className="chip"
              href={searchHref(withType(state, id))}
              key={id}
            >
              {TYPE_FILTER_LABELS[id]}
            </Link>
          ))}
        </div>
      </fieldset>
      {/* The description's writing system, read from its characters
          (src/db/queries/language.ts). Narrows only: with none chosen every
          language is listed, in the order it always was. */}
      <fieldset className="facet">
        <legend className="facet-legend">Description</legend>
        <div className="facet-chips">
          <Link
            aria-current={selectedLanguages.length === 0 ? 'true' : undefined}
            className="chip"
            href={searchHref(withLanguage(state, null))}
          >
            Any language
          </Link>
          {LANGUAGE_FILTER_IDS.map((id) => (
            <Link
              aria-current={selectedLanguages.includes(id) ? 'true' : undefined}
              className="chip"
              href={searchHref(withLanguage(state, id))}
              key={id}
            >
              {LANGUAGE_LABELS[id]}
            </Link>
          ))}
        </div>
      </fieldset>
      <fieldset className="facet">
        <legend className="facet-legend">Capability</legend>
        <div className="facet-chips">
          {CAPABILITY_FILTER_IDS.map((id) => (
            <Link
              aria-current={selectedCapabilities.includes(id) ? 'true' : undefined}
              className="chip chip-toggle"
              href={searchHref(toggleCapability(state, id))}
              key={id}
            >
              {CAPABILITY_FILTER_LABELS[id]}
            </Link>
          ))}
        </div>
      </fieldset>
    </div>
  );

  // D-08: filters describe an observation, never a completeness claim.
  const searchControls = (
    <>
      <div className="search">
        {searchForm}
        {facets}
      </div>
      <p className="notice">
        <InfoIcon />
        <span>
          These filters describe what AgentDock observed while reading the files, not everything an
          artifact can do. The network and Bash filters list only skills and commands whose text
          AgentDock has analyzed; the script filter lists only skills and plugins, whose file list
          is a directory. The description filter reads which writing system each description uses,
          as its author wrote it — nothing is translated, and the Latin alphabet includes languages
          other than English.
        </span>
      </p>
    </>
  );

  const nextSteps = (
    <p className="actions">
      {/* Only with a filter to clear. Without one it linked to the page the
          reader was already on (U3). */}
      {hasFilters ? (
        <Link className="btn btn-quiet" href={hrefFor(q, 1, NO_FILTERS, sort)}>
          Clear filters
        </Link>
      ) : null}
      {/* The same filters without the words — with no filter this is the
          "Browse all" link beside it, so it is offered only with one. */}
      {hasQuery && hasFilters ? (
        <Link className="btn btn-quiet" href={hrefFor('', 1, filters)}>
          Clear search
        </Link>
      ) : null}
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
            <Link className="btn btn-quiet" href={hrefFor(q, 1, filters, sort)}>
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
    const filterLabels = appliedFilters(q, filters).map((f) => f.label);
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
          <AppliedFilters filters={filters} q={q} sort={sort} />
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
        <PackageRows date={sort} items={items} />
      </>
    );
  }

  // A query with '/' in it is also tested as a path substring (search.ts), so
  // the rows can mark where in the path it matched.
  const pathQuery = q.includes('/') ? q : undefined;

  return (
    <>
      {pageHead}
      {searchControls}
      {/* The result set is the state of the search, so it is stated as one
          rather than tucked into a metadata line: the size of the set, then the
          slice of it on this page. Same three numbers as before — `total`,
          `offset` and `items.length` — and the same pagination arithmetic; only
          the sentence they are read in changed. */}
      <div className="result-bar">
        <p className="result-count">
          <strong>{total.toLocaleString('en-US')}</strong> {total === 1 ? 'artifact' : 'artifacts'}
          {q ? (
            <>
              {' '}
              for <span className="result-q">{q}</span>
            </>
          ) : null}
        </p>
        <p className="muted">
          Showing {offset + 1}–{offset + items.length}
        </p>
        {/* searchMode relaxed the query, and the reader is told: these match
            some of the words, not all of them. */}
        {mode === 'any' ? (
          <p className="muted">No artifact matched every word; these match at least one.</p>
        ) : null}
        <AppliedFilters filters={filters} q={q} sort={sort} />
        <SortLinks filters={filters} q={q} sort={sort} />
      </div>
      <PackageRows date={sort} items={items} pathQuery={pathQuery} />
      <Pager filters={filters} last={last} page={page} q={q} sort={sort} />
    </>
  );
}
