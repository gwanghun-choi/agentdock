import Link from 'next/link';
import { z } from 'zod';
import { PackageRows } from '@/components/PackageRows';
import { countPackages, listPackages } from '@/db/queries/packages';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Skills — AgentDock' };

const PAGE_SIZE = 25;

/**
 * Coerced through a bounded schema with a fallback, never through Number().
 * A repeated query parameter arrives as an array, and Number(['1','2']) is NaN —
 * which reaches the query as an offset that silently returns nothing.
 */
const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);

export default async function SkillsPage({
  searchParams,
}: {
  // Written by hand rather than taken from the generated route-typing helper,
  // which needs types that exist only after a build.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = pageParam.parse((await searchParams).page);
  const offset = (page - 1) * PAGE_SIZE;

  const [packages, total] = await Promise.all([
    listPackages({ limit: PAGE_SIZE, offset }),
    countPackages(),
  ]);

  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return (
      <>
        <h1>Artifacts</h1>
        <p className="muted">
          No artifacts indexed yet. <Link href="/">Submit a repository</Link>.
        </p>
      </>
    );
  }

  // A page past the end has no range to report. Reporting one anyway prints
  // "Showing 26–25 of 18", which is how a paginator tells its first lie.
  if (packages.length === 0) {
    return (
      <>
        <h1>Artifacts</h1>
        <p className="muted">
          There is no page {page}. <Link href="/skills">Back to the first page</Link> of {total}{' '}
          artifacts.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Artifacts</h1>
      <p className="muted">
        Showing {offset + 1}–{offset + packages.length} of {total}.
      </p>
      <PackageRows items={packages} />
      <p className="pager">
        {page > 1 ? <Link href={`/skills?page=${page - 1}`}>← Previous</Link> : null}
        {page < last ? <Link href={`/skills?page=${page + 1}`}>Next →</Link> : null}
        <span className="muted">
          Page {page} of {last}
        </span>
      </p>
    </>
  );
}
