import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArtifactBadge } from '@/components/ArtifactBadge';
import { ClockIcon, StarIcon } from '@/components/Icon';
import { compactStars } from '@/components/PackageRows';
import { detailHref, type PackageListItem } from '@/db/queries/packages';

/**
 * The activity rail: the same feed the list below reads, drifting past as
 * compact cards.
 *
 * It is a second reading of one feed, not a second feed — a ticker over a table
 * of the same rows, which is what every board that has to show both "what is
 * happening" and "what does it say" does. The list underneath is the one you
 * read; this is the one you glance at, and it is where the shape of the index
 * (which kinds of thing are arriving, from which repositories) is legible
 * without reading a word.
 *
 * Nothing new is queried for it. `page.tsx` makes the one `listPackages` call it
 * always made and hands the same array to both.
 *
 * ## The loop
 *
 * Two identical halves inside one track, and the track animates to
 * `translateX(-50%)`. At -50% the second half sits exactly where the first
 * started, so the loop has no seam and no reset to hide. That identity is the
 * whole mechanism and it is fragile in one specific way: every card carries its
 * gap as its own trailing margin rather than the flex `gap` property, because a
 * `gap` between the two halves would make the track `2 × half + gap` wide and
 * -50% would land half a gap off, drifting one gap per cycle.
 *
 * ## The second half and assistive technology
 *
 * `inert` plus `aria-hidden`, not one or the other. `aria-hidden` alone leaves
 * eighteen links in the tab order that a screen-reader user has already been
 * past — the exact "hidden node a keyboard can reach" pattern that got a <kbd>
 * removed from the search field earlier, and what axe reports as
 * `aria-hidden-focus`. `inert` is the platform's own answer: it takes the
 * subtree out of the tab order, out of hit testing and out of the accessibility
 * tree at once. The duplicate exists to make an animation seamless and has no
 * other reason to be reachable by anything.
 *
 * Under reduced motion and on a touch pointer it is `display: none` — see
 * globals.css. There is no loop to be seamless about when nothing is moving.
 *
 * ponytail: the duplicate is in the HTML either way, and it is not free.
 * Measured on this page: 26,704 B of markup, 3,950 B gzipped, 12.2% of the home
 * document — paid in full by every reader who has asked for less motion or is
 * on a phone, and never painted for any of them.
 *
 * The upgrade is to duplicate only as many cards as cover the widest viewport
 * (six rather than eighteen) and animate to an explicit
 * `calc(var(--rail-items) * -17.75rem)` instead of -50%. Not built, and the
 * reason is the trade rather than the effort: -50% is derived from whatever the
 * track actually measures, so it cannot drift. A px-derived keyframe hardcodes
 * the card width in a second place, and the day someone changes `.rail-card`'s
 * 17rem the loop starts sliding a little further out of register every cycle —
 * a silent visual bug, traded for four kilobytes. Revisit if the rail ever
 * carries enough cards for this to be a page-weight problem rather than a
 * rounding error.
 */

const RAIL_LABEL = 'Recently indexed artifacts';

function RailCard({ item }: { item: PackageListItem }) {
  return (
    <Link className="rail-card" href={detailHref(item.fullName, item.sourcePath, item.type)}>
      <span className="rail-card-top">
        <ArtifactBadge type={item.type} />
        {/* Same register and same title text as the listing row's star count:
            a fact about where this came from, never a rank. */}
        <span
          className="rail-card-stars"
          title={`${item.stars.toLocaleString('en-US')} GitHub stars`}
        >
          <StarIcon /> {compactStars(item.stars)}
        </span>
      </span>
      <span className="rail-card-name">{item.name}</span>
      <span className="rail-card-repo">{item.fullName}</span>
      {/* Absent, not blank. An artifact that declared no summary is a different
          fact from one whose summary is empty, and a placeholder line here would
          render them the same. */}
      {item.summary ? <span className="rail-card-desc">{item.summary}</span> : null}
      {/* The read date closes the card, not the source path.

          The path was here first and it truncated at 17rem —
          `skills/baoyu-danger-gemini-web/SKI`. PackageRows has never clamped a
          path, on the stated grounds that a truncated path is a useless path,
          and a card is not a reason to start. The date is short, never
          truncates at any card width, and is the other fact the row below
          carries; the path is one click away and is on that row in full. */}
      {item.scannedAt ? (
        <span className="rail-card-read">
          <ClockIcon /> read {item.scannedAt.toISOString().slice(0, 10)}
        </span>
      ) : null}
    </Link>
  );
}

export function ArtifactRail({ items }: { items: PackageListItem[] }) {
  if (items.length === 0) return null;

  return (
    // Two elements, and the outer one is not decoration. The frame — border,
    // background, radius — has to sit on an element the edge mask does not
    // touch, because `mask-image` fades everything the element paints, border
    // included, and a panel whose own outline dissolves at both ends looks
    // broken rather than soft.
    //
    // --rail-items is what keeps the speed constant rather than the duration.
    // A fixed 120s would crawl at eighteen cards and sprint at forty; the
    // stylesheet multiplies this by seconds-per-card instead, and the cards are
    // a fixed width so the result is an exact px/s.
    <div className="rail-well" style={{ '--rail-items': items.length } as CSSProperties}>
      <div className="rail">
        <div className="rail-track">
          <ul aria-label={RAIL_LABEL} className="rail-set">
            {items.map((item) => (
              <li key={item.id}>
                <RailCard item={item} />
              </li>
            ))}
          </ul>
          <ul aria-hidden="true" className="rail-set rail-set-dup" inert>
            {items.map((item) => (
              <li key={`loop-${item.id}`}>
                <RailCard item={item} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
