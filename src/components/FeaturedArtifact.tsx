import Link from 'next/link';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { ClockIcon, ExternalIcon, FileIcon, StarIcon } from '@/components/Icon';
import { compactStars } from '@/components/PackageRows';
import { detailHref, type PackageListItem, permalink } from '@/db/queries/packages';

/**
 * The newest thing in the window, at the size of an answer.
 *
 * The board used to open with a heading and a row of small tiles, which made
 * "what has AgentDock just read" — the question this whole section exists to
 * answer — the least prominent thing on it. This is that answer, given once, at
 * a size nothing else on the page competes with: the artifact at the head of the
 * same array the rail and the list read.
 *
 * ## It queries nothing
 *
 * `items[0]` of the array `page.tsx` already had. No new call, no aggregate, no
 * "featured" flag in the database and no editorial choice — this is the most
 * recently read artifact and nothing else. It is not a recommendation, not a
 * pick, and not ranked: AgentDock does not rank artifacts, and a card this size
 * is exactly where that would start if the selection were anything other than
 * "newest".
 *
 * Which is why the label says "Latest read" rather than "Featured". The word
 * featured implies somebody chose it.
 *
 * ## Same facts, same words
 *
 * Every field is one a listing row already shows, in the same register and
 * through the same helpers: `detailHref` for the internal link, `permalink` for
 * the GitHub one at the commit that was read, `compactStars` for the count. The
 * star count keeps its `title` in full words for the same reason the row's does
 * — it is a fact about where this came from, never a rank.
 */
export function FeaturedArtifact({ item }: { item: PackageListItem }) {
  return (
    <article className="featured">
      <p className="featured-eyebrow">
        <ClockIcon /> Latest read
        {item.scannedAt ? <span>{item.scannedAt.toISOString().slice(0, 10)}</span> : null}
      </p>

      <ArtifactBadge type={item.type} />

      <h3 className="featured-name">
        <Link href={detailHref(item.fullName, item.sourcePath, item.type)}>{item.name}</Link>
      </h3>

      <p className="featured-repo">{item.fullName}</p>

      {/* Absent, not blank. An artifact that declared no summary is a different
          fact from one whose summary is empty. */}
      {item.summary ? <p className="featured-desc">{item.summary}</p> : null}

      <p className="featured-meta">
        <span className="path">
          <FileIcon /> {item.sourcePath}
        </span>
        <span title={`${item.stars.toLocaleString('en-US')} GitHub stars`}>
          <StarIcon /> {compactStars(item.stars)}
        </span>
        {item.commitSha ? (
          <a
            className="row-source"
            href={permalink(item.fullName, item.commitSha, item.sourcePath)}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalIcon /> source on GitHub
          </a>
        ) : null}
      </p>
    </article>
  );
}
