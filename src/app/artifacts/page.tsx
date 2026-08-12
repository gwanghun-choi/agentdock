import { PackageRows } from '@/components/PackageRows';
import { listPackages } from '@/db/queries/packages';
import { searchPackages } from '@/db/queries/search';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Artifacts — AgentDock' };

const PAGE_SIZE = 25;

/**
 * The tracer's scope only: read `q`, render rows, stop. No filters, no
 * pager, no zero-result copy, no logging — 06-02 and 06-03 add those.
 * `src/app/skills/page.tsx` stays as it is; 06-02 owns its rename and the
 * `/skills` -> `/artifacts` redirect.
 *
 * An empty/whitespace `q` skips searchPackages entirely and falls back to
 * listPackages' browse ordering — `websearch_to_tsquery('')` matches
 * nothing via `@@` (verified live), so passing an empty query through would
 * silently return zero rows for browse mode rather than everything.
 */
export default async function ArtifactsPage({
  searchParams,
}: {
  // Written by hand rather than taken from the generated route-typing
  // helper, which needs types that exist only after a build.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).q;
  const q = (typeof raw === 'string' ? raw : '').trim();

  const items = q
    ? await searchPackages({ q, limit: PAGE_SIZE })
    : await listPackages({ limit: PAGE_SIZE });

  return (
    <>
      <h1>Artifacts</h1>
      <p className="muted">
        {q ? `${items.length} result(s) for "${q}".` : `Showing ${items.length} artifacts.`}
      </p>
      <PackageRows items={items} />
    </>
  );
}
