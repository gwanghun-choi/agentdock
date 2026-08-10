import { notFound } from 'next/navigation';
import { metaDescription } from '@/components/metadata';
import { PackageRows } from '@/components/PackageRows';
import { getRepositoryPackages } from '@/db/queries/packages';

// Read at request time. next build runs in CI, where there is no database.
export const dynamic = 'force-dynamic';

// Written by hand rather than taken from the generated route-typing helper,
// which needs types that exist only after a build or an explicit generation step.
type Props = { params: Promise<{ owner: string; repo: string }> };

export async function generateMetadata({ params }: Props) {
  const { owner, repo } = await params;
  const found = await getRepositoryPackages(owner, repo);
  if (!found) return { title: 'Not found — AgentDock' };
  return {
    title: `${found.repository.fullName} — AgentDock`,
    description: metaDescription(found.repository.description),
  };
}

export default async function RepositoryPage({ params }: Props) {
  const { owner, repo } = await params;
  const found = await getRepositoryPackages(owner, repo);
  if (!found) notFound();

  const { repository, packages } = found;

  return (
    <>
      <h1>{repository.fullName}</h1>
      {repository.description ? <p className="lede">{repository.description}</p> : null}

      {repository.treeTruncated ? (
        // A visible state, never a silent claim of completeness.
        <p className="error">
          AgentDock read part of this repository, so this listing is not everything that is in it.
        </p>
      ) : null}

      <p className="row-meta">
        <span>{repository.stars} GitHub stars</span>
        <span>Licence, detected by GitHub: {repository.licenseSpdx ?? 'not detected'}</span>
        {repository.isArchived ? <span>Archived on GitHub</span> : null}
      </p>
      <p className="row-meta">
        <span>
          Last changed upstream:{' '}
          {repository.pushedAt ? repository.pushedAt.toISOString().slice(0, 10) : 'unknown'}
        </span>
        <span>
          Last read by AgentDock:{' '}
          {repository.scannedAt
            ? `${repository.scannedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
            : 'never'}
        </span>
      </p>

      <h2>
        {packages.length} skill{packages.length === 1 ? '' : 's'}
      </h2>
      {packages.length === 0 ? (
        <p className="muted">AgentDock currently lists nothing from this repository.</p>
      ) : (
        <PackageRows items={packages} showRepo={false} />
      )}
    </>
  );
}
