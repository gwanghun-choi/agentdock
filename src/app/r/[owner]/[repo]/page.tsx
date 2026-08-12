import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalIcon } from '@/components/Icon';
import { metaDescription } from '@/components/metadata';
import { PackageRows } from '@/components/PackageRows';
import { latestJobForTarget } from '@/db/queries/jobs';
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

  // Every artifact here, listed or not. COR-07's other half: a suppressed
  // artifact stays reachable at its own URL, and the page that still shows it is
  // the page that owes the reader an explanation.
  const notListed = packages.filter((p) => p.notListedBecause !== null);
  const byReason = {
    fork: notListed.filter((p) => p.notListedBecause === 'fork').length,
    duplicate: notListed.filter((p) => p.notListedBecause === 'duplicate').length,
    unparsed: notListed.filter((p) => p.notListedBecause === 'unparsed').length,
  };
  // Says where the artifact is, or what AgentDock did, never what it is worth.
  // "A fork on GitHub" is a location. "Byte-identical to" is a measurement.
  // "AgentDock could not read" is a verb of observation about AgentDock, not a
  // judgment about the file. None of it implies an excluded artifact is worse
  // than an included one, and none of it uses a word from the rule 6 list.
  const reasons = [
    byReason.fork > 0
      ? `${byReason.fork} ${byReason.fork === 1 ? 'is' : 'are'} in a fork of another repository`
      : null,
    byReason.duplicate > 0
      ? `${byReason.duplicate} ${byReason.duplicate === 1 ? 'is' : 'are'} byte-identical to an artifact AgentDock already lists`
      : null,
    byReason.unparsed > 0
      ? `${byReason.unparsed} ${byReason.unparsed === 1 ? 'has' : 'have'} a file whose frontmatter AgentDock could not read`
      : null,
  ].filter((line) => line !== null);
  // What AgentDock is currently doing about this repository. A succeeded job
  // adds nothing the timestamp below does not already say, so only an unfinished
  // or failed one is linked.
  const job = await latestJobForTarget(repository.fullName);

  return (
    <>
      <div className="detail-head">
        <h1>{repository.fullName}</h1>
        {repository.description ? <p className="lede">{repository.description}</p> : null}
        <div className="detail-actions">
          <a
            href={`https://github.com/${repository.fullName}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalIcon /> Repository on GitHub
          </a>
        </div>
      </div>

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
        {/* Same register as the archived disclosure beside it: a fact GitHub
            reports about where this repository is, not a claim about it. */}
        {repository.isFork ? <span>A fork on GitHub</span> : null}
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
        {/* A short prefix rather than a second link: each artifact's permalink
            already resolves to the exact file at this exact commit, and a second
            link to the same commit is a duplicate a reader has to disambiguate. */}
        {repository.lastIngestedSha ? (
          <span>At commit {repository.lastIngestedSha.slice(0, 7)}</span>
        ) : null}
        {job && job.status !== 'succeeded' ? (
          <span>
            <Link href={`/jobs/${job.id}`}>
              {job.status === 'failed' ? 'The last read failed' : 'AgentDock is reading it now'}
            </Link>
          </span>
        ) : null}
      </p>

      {/* "skill" was wrong here for five of the six types. This repository page
          has listed commands, plugins, hooks and MCP declarations since Phase 3;
          calling all of them skills was the same Skill-only wording leak the
          detail route carried, in the one place that survived it. */}
      <h2>
        {packages.length} artifact{packages.length === 1 ? '' : 's'}
      </h2>
      {/* Nothing at all when the count is zero. A line reading "0 of these are
          not in AgentDock's listings" is noise on every well-formed repository,
          which is most of them. */}
      {notListed.length > 0 ? (
        <p className="muted">
          {notListed.length} of these {notListed.length === 1 ? 'is' : 'are'} on this page and not
          in AgentDock&apos;s listings elsewhere: {reasons.join('; ')}. Each one is still readable
          here.
        </p>
      ) : null}
      {packages.length === 0 ? (
        <p className="muted">AgentDock currently lists nothing from this repository.</p>
      ) : (
        <PackageRows items={packages} showRepo={false} />
      )}
    </>
  );
}
