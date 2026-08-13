import type { CSSProperties } from 'react';
import { artifactTypeLabel } from '@/components/ArtifactBadge';
import { ClockIcon, RepoIcon } from '@/components/Icon';
import type { PackageListItem } from '@/db/queries/packages';

/**
 * Three tiles over the rail, describing the window the board is showing.
 *
 * ## Why these three and not a row of big corpus numbers
 *
 * The corpus total is already on this page, counted up in the hero, and putting
 * it here again would be the same number twice with nothing gained. The board is
 * about what arrived *recently*, so these describe the recent window: when the
 * newest thing in it was read, how many repositories it came from, and what
 * kinds of thing they were.
 *
 * ## Every number here is scoped, out loud
 *
 * All three are computed from the eighteen items `page.tsx` already fetched —
 * no second query, no aggregate the database was not already asked for. That
 * makes them true of the window and *not* true of the corpus, and a dashboard
 * figure with no window on it is read as a total by everyone who sees it. So the
 * window is in the label of every tile that could be mistaken for one ("in these
 * 18"), not in a footnote under the grid.
 *
 * This is the same rule the rest of the project follows for a bounded run: a cap
 * that prints nothing reads as "we covered everything". A count that names no
 * window reads as "this is all of it".
 *
 * ## The distribution is a bar, and it is not a ranking
 *
 * The kinds tile is ordered by count because a bar chart sorted by anything else
 * is unreadable, and that ordering says which kinds arrived most often in these
 * eighteen — nothing about which kind is better, more popular or more
 * trustworthy. There is no score here, no total across the corpus, and the bar
 * is proportioned within the window it names.
 *
 * Nothing renders if the window is empty; `page.tsx` does not reach this branch
 * then, but a component that divides by a length should say what it does at
 * zero.
 */
export function BoardStats({
  items,
  newestRead,
}: {
  items: PackageListItem[];
  newestRead: string | null;
}) {
  if (items.length === 0) return null;

  const repositories = new Set(items.map((i) => i.fullName)).size;

  // Insertion order is first-seen order; sorting by count after makes the bar
  // readable. Ties keep first-seen order, which is stable across renders
  // because the query's ordering is.
  const byType = new Map<string, number>();
  for (const item of items) byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
  const kinds = [...byType.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <dl className="tiles">
      <div className="tile">
        <dt>
          <ClockIcon /> Newest read
        </dt>
        <dd>
          <span className="metric">{newestRead ?? '—'}</span>
          <small>the date AgentDock read the most recent of these</small>
        </dd>
      </div>

      <div className="tile">
        <dt>
          <RepoIcon /> Repositories
        </dt>
        <dd>
          <span className="metric">{repositories}</span>
          <small>distinct repositories among these {items.length}, not across the corpus</small>
        </dd>
      </div>

      <div className="tile tile-wide">
        <dt>Kinds in these {items.length}</dt>
        <dd>
          <ul className="dist">
            {kinds.map(([type, count]) => (
              <li key={type}>
                <span className="dist-label">{artifactTypeLabel(type)}</span>
                {/* A track with a bar in it, rather than a bare bar: the track
                    is what makes a share readable as a share. Both are
                    aria-hidden — the label and the count beside them are the
                    same information in words, and a screen reader reading a
                    decorative bar as well would say it twice.

                    The bar takes the artifact type's own hue from the badge
                    palette by class rather than restating it here, so a type
                    that is green on its badge is green on this bar and there is
                    one place to change it. */}
                <span aria-hidden="true" className="dist-track">
                  <span
                    className={`dist-bar badge-${type}`}
                    style={{ '--share': count / items.length } as CSSProperties}
                  />
                </span>
                <span className="dist-count">{count}</span>
              </li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}
