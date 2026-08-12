import Link from 'next/link';
import { z } from 'zod';
import { PackageRows } from '@/components/PackageRows';
import {
  countSearchResults,
  normalizeQuery,
  SEARCH_CAPS,
  searchPackages,
} from '@/db/queries/search';

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
 * The one URL builder every link on this page uses: Previous, Next, and
 * both empty-state links. Four hand-built template strings is four chances
 * to drop `q` from one of them while the other three keep it — this is the
 * single place that re-emits it, so pagination cannot silently lose search
 * state (D-35/D-36). 06-03 extends this with the filter parameters.
 */
function hrefFor(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/artifacts?${qs}` : '/artifacts';
}

/**
 * Browse-and-search over the listing-visible corpus. `q` empty or absent
 * browses (D-17/D-18, handled entirely inside searchPackages — this route
 * never branches on `q` itself); `q` present searches, ranked per D-12.
 *
 * A plain GET form with native controls, no client component: the CSP
 * already permits it (`form-action 'self'`, src/proxy.ts:49), it works with
 * JavaScript disabled, and it puts `q` in the URL where D-35 requires it.
 * Default to a server-rendered GET form and native controls; reach for
 * 'use client' only when a control needs interaction a GET form cannot
 * express — this is the first of several controls (06-03 adds the rest on
 * the same convention).
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

  const [items, total] = await Promise.all([
    searchPackages({ q, limit: SEARCH_CAPS.pageSize, offset }),
    countSearchResults({ q }),
  ]);

  const last = Math.max(1, Math.ceil(total / SEARCH_CAPS.pageSize));

  const searchForm = (
    <form method="get" action="/artifacts" className="search">
      <label htmlFor="q">Search artifacts</label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        maxLength={SEARCH_CAPS.maxQueryLength}
      />
      <button type="submit">Search</button>
    </form>
  );

  // Corpus empty (browse mode, nothing indexed at all). Checked on q === ''
  // specifically: a query that happens to match nothing is a different fact
  // (branch 3, below) than "AgentDock holds no artifacts yet".
  if (q === '' && total === 0) {
    return (
      <>
        <h1>Artifacts</h1>
        {searchForm}
        <p className="muted">
          No artifacts indexed yet. <Link href="/">Submit a repository</Link>.
        </p>
      </>
    );
  }

  // A page past the end has no range to report. Reporting one anyway prints
  // "Showing 26-25 of 18", which is how a paginator tells its first lie.
  // Carried from skills/page.tsx; the first-page link now carries `q` so a
  // reader is not silently dropped out of their search.
  if (total > 0 && items.length === 0) {
    return (
      <>
        <h1>Artifacts</h1>
        {searchForm}
        <p className="muted">
          There is no page {page}. <Link href={hrefFor(q, 1)}>Back to the first page</Link> of{' '}
          {total} artifacts.
        </p>
      </>
    );
  }

  // Zero search results — structurally distinct from both branches above.
  // 06-03 owns the final copy (D-38: next steps, never "does not exist").
  if (items.length === 0) {
    return (
      <>
        <h1>Artifacts</h1>
        {searchForm}
        {/* TODO(06-03): D-38 zero-result copy — reset filters / browse all. */}
        <p className="muted">No artifacts matched &quot;{q}&quot;.</p>
      </>
    );
  }

  return (
    <>
      <h1>Artifacts</h1>
      {searchForm}
      <p className="muted">
        {q
          ? `Showing ${offset + 1}–${offset + items.length} of ${total} for "${q}".`
          : `Showing ${offset + 1}–${offset + items.length} of ${total}.`}
      </p>
      <PackageRows items={items} />
      <p className="pager">
        {page > 1 ? <Link href={hrefFor(q, page - 1)}>← Previous</Link> : null}
        {page < last ? <Link href={hrefFor(q, page + 1)}>Next →</Link> : null}
        <span className="muted">
          Page {page} of {last}
        </span>
      </p>
    </>
  );
}
