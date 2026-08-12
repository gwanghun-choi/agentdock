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
/**
 * 12,400 -> "12.4k". One decimal below a hundred thousand, none above, so the
 * column never widens past five characters and a row's metadata line does not
 * reflow around a popular repository.
 *
 * Truncates rather than rounds: 12,999 is "12.9k", never "13k". A count shown
 * larger than it is is the one direction this must not round in.
 */
export function compactStars(stars: number): string {
  if (stars < 1_000) return String(stars);
  const thousands = stars / 1_000;
  return thousands < 100
    ? `${(Math.floor(thousands * 10) / 10).toFixed(1)}k`
    : `${Math.floor(thousands)}k`;
}

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
            {/* The repository's star count, in the metadata line beside the
                path and the read date — the register of "facts about where this
                came from", never a rank or a score. It is not a sort key, not a
                badge, and not styled to compete with the name: `title` says in
                words what the glyph means so it cannot be read as a rating.
                src/db/queries/search.ts consults it for nothing. */}
            <span title={`${p.stars.toLocaleString('en-US')} GitHub stars`}>
              ★ {compactStars(p.stars)}
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
