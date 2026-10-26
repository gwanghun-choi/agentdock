import Link from 'next/link';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { detailHref, permalink } from '@/components/hrefs';
import { CommitIcon, DockIcon, FileIcon, RepoIcon, StarIcon } from '@/components/Icon';
import { htmlLang } from '@/components/language';
import { compactStars } from '@/components/PackageRows';
import type { PackageListItem } from '@/db/queries/packages';

/**
 * The hero's picture: the newest artifact in the listing, drawn as the four
 * things that happened to it — the repository it is in, the file that declares
 * it, AgentDock reading that file, and the commit the read was filed against.
 *
 * It is the index flow further down the page with one real artifact run through
 * it, so the stages are the same four in the same order (IndexFlow.tsx), and
 * every value on it is a column the listing row already shows: no new query, no
 * editorial pick. "Latest read" rather than "Featured", for the reason
 * FeaturedArtifact gave before Phase 54 — nobody chose it, it is the newest.
 *
 * The same artifact is the first row of "Recently indexed" below. That is one
 * repetition, desktop only — under 64rem this figure is not displayed, and the
 * phone's first screen is the search box and that row (e2e/journeys.spec.ts).
 * Phase 54 removed a card, a rail and a list that showed one feed three times;
 * this draws one row of it a second way, as a diagram rather than as a feed.
 *
 * <figure> with a caption, and the lane is an <ol>: the order is the fact. The
 * lane, the nodes and the travelling light are CSS, so with styles off this is
 * a numbered list of four short lines and a link.
 */
export function LatestRead({ item }: { item: PackageListItem }) {
  const href = detailHref(item.fullName, item.sourcePath, item.type);
  return (
    <figure aria-labelledby="latest-read" className="trace">
      <figcaption id="latest-read">
        Latest read
        {item.scannedAt ? (
          <span className="trace-date"> {item.scannedAt.toISOString().slice(0, 10)}</span>
        ) : null}
      </figcaption>
      <ol className="trace-lane">
        <li>
          <RepoIcon />
          <span className="trace-value">{item.fullName}</span>
          <span
            className="trace-aside"
            title={`${item.stars.toLocaleString('en-US')} GitHub stars`}
          >
            <StarIcon /> {compactStars(item.stars)}
          </span>
        </li>
        <li>
          <FileIcon />
          <span className="trace-value path">{item.sourcePath}</span>
        </li>
        <li>
          <DockIcon />
          <span className="trace-value">Read, never run</span>
        </li>
        <li>
          <CommitIcon />
          {item.commitSha ? (
            <a
              className="trace-value trace-sha"
              href={permalink(item.fullName, item.commitSha, item.sourcePath)}
              rel="noopener noreferrer"
              target="_blank"
            >
              <span className="sr-only">Source on GitHub at commit </span>
              {item.commitSha.slice(0, 7)}
            </a>
          ) : (
            // Absent, not invented: a listed row with no version yet.
            <span className="trace-value">No commit recorded</span>
          )}
        </li>
      </ol>
      {/* The whole card is the target (the name's ::after covers it), but the
          link's name is the artifact's: as one <a> around the card, a screen
          reader read the type, the name and the full description as its name. */}
      <div className="trace-card">
        <ArtifactBadge type={item.type} />
        <Link className="trace-name" href={href}>
          {item.name}
        </Link>
        {/* No description, no line — as on a listing row. */}
        {item.summary ? (
          <span className="trace-desc" lang={htmlLang(item.summaryLanguage)}>
            {item.summary}
          </span>
        ) : null}
      </div>
    </figure>
  );
}
