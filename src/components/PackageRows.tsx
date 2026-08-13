import Link from 'next/link';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { ClockIcon, ExternalIcon, FileIcon, StarIcon } from '@/components/Icon';
import { detailHref, type PackageListItem, permalink } from '@/db/queries/packages';

/**
 * Dense bordered rows, not cards. Three lines per item so a screenful still
 * holds twenty: a title line, a clamped description, and a metadata line. The
 * path is never clamped — a truncated path is a useless path.
 *
 * The type badge is in a column of its own rather than inline in the title.
 * Type is the first thing a reader filters on mentally, and inline it sat at a
 * different x on every row — one left edge per artifact name above it, which is
 * exactly as much help as no label at all when the question is "which of these
 * twenty are plugins". In its own column every badge lands on the same vertical
 * line and the answer is a glance. Below 52rem the column collapses and the
 * badge goes back above the title, where its position is constant too. The
 * column is 9rem, measured against the widest of the six labels — see
 * globals.css.
 *
 * The repository trails the name in monospace so the two identifiers are never
 * confused.
 *
 * The GitHub permalink is the only external link in the row and says so with an
 * icon and an explicit label, keeping §16's internal/external distinction
 * visible. It is also the row's right-hand anchor: pushed to the trailing edge,
 * it is the one item in the metadata line at a predictable position on every
 * row. Its href still comes from `permalink()`, unchanged — the commit-SHA
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
          <div className="row-type">
            <ArtifactBadge type={p.type} />
          </div>
          <div className="row-main">
            <p className="row-title">
              <Link href={detailHref(p.fullName, p.sourcePath, p.type)}>{p.name}</Link>
              {showRepo ? <span className="repo">{p.fullName}</span> : null}
            </p>
            {p.summary ? <p className="row-desc">{p.summary}</p> : null}
            <p className="row-meta">
              <span className="path">
                <FileIcon /> {p.sourcePath}
              </span>
              {/* The repository's star count, in the metadata line beside the
                  path and the read date — the register of "facts about where
                  this came from", never a rank or a score. It is not a sort
                  key, not a badge, and not styled to compete with the name:
                  `title` says in words what the glyph means so it cannot be
                  read as a rating, and the glyph replaces a bare ★ character
                  that rendered at a different size and baseline in every font
                  the icons beside it did not. src/db/queries/search.ts consults
                  it for nothing. */}
              <span className="row-stars" title={`${p.stars.toLocaleString('en-US')} GitHub stars`}>
                <StarIcon /> {compactStars(p.stars)}
              </span>
              {p.scannedAt ? (
                <span>
                  <ClockIcon /> read {p.scannedAt.toISOString().slice(0, 10)}
                </span>
              ) : null}
              {p.commitSha ? (
                <a
                  className="row-source"
                  href={permalink(p.fullName, p.commitSha, p.sourcePath)}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalIcon /> source on GitHub
                </a>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
