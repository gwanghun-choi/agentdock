import Link from 'next/link';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { ClockIcon, ExternalIcon, FileIcon } from '@/components/Icon';
import { detailHref, type PackageListItem, permalink } from '@/db/queries/packages';

/**
 * Dense bordered rows, not cards. Three lines per item so a screenful still
 * holds twenty: a title line carrying the type badge, a clamped description,
 * and a metadata line. The path is never clamped — a truncated path is a
 * useless path.
 *
 * The type badge leads the title because type is the first thing a reader
 * filters on mentally, and it is what a plain list of names could not show at
 * all. The repository trails the name in monospace so the two identifiers are
 * never confused.
 *
 * The GitHub permalink is the only external link in the row and says so with an
 * icon and an explicit label, keeping §16's internal/external distinction
 * visible. Its href still comes from `permalink()`, unchanged — the commit-SHA
 * provenance invariant is not a presentation concern.
 */
export function PackageRows({
  items,
  showRepo = true,
}: {
  items: PackageListItem[];
  showRepo?: boolean;
}) {
  return (
    <ul className="rows">
      {items.map((p) => (
        <li key={p.id}>
          <p className="row-title">
            <Link href={detailHref(p.fullName, p.sourcePath, p.type)}>{p.name}</Link>
            <ArtifactBadge type={p.type} />
            {showRepo ? <span className="repo">{p.fullName}</span> : null}
          </p>
          {p.summary ? <p className="row-desc">{p.summary}</p> : null}
          <p className="row-meta">
            <span className="path">
              <FileIcon /> {p.sourcePath}
            </span>
            {p.scannedAt ? (
              <span>
                <ClockIcon /> read {p.scannedAt.toISOString().slice(0, 10)}
              </span>
            ) : null}
            {p.commitSha ? (
              <a
                href={permalink(p.fullName, p.commitSha, p.sourcePath)}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalIcon /> source on GitHub
              </a>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
