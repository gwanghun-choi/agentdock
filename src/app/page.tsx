import Link from 'next/link';
import { ArtifactRail } from '@/components/ArtifactRail';
import { BoardStats } from '@/components/BoardStats';
import { FeaturedArtifact } from '@/components/FeaturedArtifact';
import {
  ArchiveIcon,
  ArrowRightIcon,
  DockIcon,
  ForkIcon,
  GlobeIcon,
  InfoIcon,
  RepoIcon,
  SearchIcon,
  StarIcon,
} from '@/components/Icon';
import { IndexFlow } from '@/components/IndexFlow';
import { PackageRows } from '@/components/PackageRows';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import { countPackages, listPackages } from '@/db/queries/packages';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

/**
 * One query, two readings.
 *
 * The rail drifts through all eighteen; the list underneath reads the ten it
 * always read. Eighteen is a rail long enough that the loop is not obvious at a
 * glance and short enough that a cycle stays under two minutes at a readable
 * speed — and it is one `listPackages` call, the same one this page has always
 * made, with a larger limit. No second query, no second round trip.
 */
const RAIL_ITEMS = 18;
const LIST_ROWS = 10;

export default async function HomePage() {
  const [recent, total] = await Promise.all([listPackages({ limit: RAIL_ITEMS }), countPackages()]);
  // Exact rather than approximate: the repository this artifact came from was
  // read on this date. Not "the corpus was read on" — that is a different claim
  // and this page does not have the number for it.
  const newestRead = recent[0]?.scannedAt?.toISOString().slice(0, 10) ?? null;

  return (
    <>
      {/* Description, then the one action. The action used to be a form that
          indexed whatever repository a visitor typed; AgentDock has no accounts
          and no operator review, so that was an unauthenticated way to spend a
          shared 60-request budget and to put any repository at all into the
          index. Browsing is what this page is for now, so that is the button. */}
      {/* Two columns above 64rem, and the second one is the point. The copy has
          always been capped at --prose (46rem) inside a 72rem shell, so 40% of
          this section was empty canvas on every desktop that ever loaded it.
          What fills it is not decoration: it is the four steps the sentence to
          its left describes, named and drawn, which is the one thing the
          paragraph could not do. Below 64rem it stacks underneath, in reading
          order, because that is the order it is written in. */}
      <section className="hero">
        <div className="hero-copy">
          <h1>Find agent artifacts, and see where they came from.</h1>
          <p className="lede">
            An open index of skills, plugins, marketplaces, MCP servers, commands and hooks — read
            from established public repositories, linked back to the exact commit.
          </p>

          {/* The search box, not a button that goes to one.
              Searching is what this site is for, so it is the control the page
              opens with rather than the second of two links to somewhere else.

              It is the same GET to the same route with the same parameter name
              the artifacts page's own form submits — no new endpoint, no
              suggestions, no client component. `id="q"` is deliberate and is
              the id SearchHotkey looks up first: on this page `/` and the chord
              now put the cursor straight in here instead of opening the
              launcher over it, which is that component's documented order
              (a page that has the field focuses it). Every other page is
              unchanged and still gets the launcher. */}
          <form action="/artifacts" className="hero-search search-row" method="get">
            <label className="sr-only" htmlFor="q">
              Search artifacts
            </label>
            <span className="field">
              <SearchIcon />
              <input
                id="q"
                name="q"
                placeholder="Search skills, plugins, MCP servers…"
                type="search"
              />
            </span>
            <button type="submit">Search</button>
          </form>

          <p className="actions">
            <Link className="btn btn-quiet" href="/artifacts">
              Browse all {total} artifacts <ArrowRightIcon />
            </Link>
          </p>
        </div>

        {/* The pipeline, across the full width of the shell rather than in a
            sidebar beside the headline. */}
        <IndexFlow total={total} />

        {/* Three facts that were sentences inside the diagram. They are
            properties of the whole flow rather than of any one stage, and each
            is enforced somewhere in the codebase — the discovery gate below
            states the first at length, AGENTS.md's "AgentDock reads; it never
            runs" is the second, and permalink()'s commit sha is the third.
            Never a claim about an artifact: only about what AgentDock does. */}
        <ul className="trust">
          <li>Public repositories only, never by request</li>
          <li>Files are read, never executed</li>
          <li>Linked to the exact commit that was read</li>
        </ul>
      </section>

      {/* The board. Three layers, in the order a reader uses them: what this is
          and what to do next, then the rail to glance at, then the rows to
          read. The rail never replaces the rows — a feed you can only watch go
          past is not a feed you can use, and the rows are also where a reader
          who cannot or does not want to track a moving target gets everything
          the rail shows. */}
      <section aria-labelledby="recent-heading" className="board">
        <div className="section-head">
          <h2 id="recent-heading">Recently indexed</h2>
          {recent.length > 0 ? (
            <p className="board-meta">
              {recent.length} most recent
              {newestRead ? ` · newest read ${newestRead}` : ''}
            </p>
          ) : null}
          {recent.length > 0 ? (
            <p className="board-actions">
              {/* WCAG 2.2.2. Hovering pauses the rail and so does focusing a
                  card, but neither is a mechanism for a reader who does
                  neither — someone reading with a magnifier, or on a device
                  with no hover at all on a viewport wide enough to still be
                  animating. This is that mechanism, and it is a checkbox
                  because a checkbox is a real control with a real state that
                  the keyboard already reaches, and because :has() makes it
                  work with no JavaScript.

                  It is hidden wherever there is nothing to pause — reduced
                  motion, and coarse pointers, where the rail is a plain
                  scroller. A pause button for something standing still is
                  worse than no button. */}
              <label className="rail-pause">
                <input type="checkbox" /> Pause
              </label>
              <Link className="board-search" href="/artifacts?q=">
                <SearchIcon /> Search
              </Link>
              <Link href="/artifacts">
                Browse all {total} artifacts <ArrowRightIcon />
              </Link>
            </p>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <p className="muted">
              Nothing indexed yet. The scheduled sync fills this the next time it runs.
            </p>
          </div>
        ) : (
          <>
            {/* The dashboard: the newest artifact at full size beside the three
                figures describing the window it came from. Both read the same
                `recent` array the rail and the list read — no new query, and
                every figure that could be mistaken for a corpus total names its
                window in its own label. See BoardStats.tsx. */}
            <div className="board-grid">
              <FeaturedArtifact item={recent[0]} />
              <BoardStats items={recent} newestRead={newestRead} />
            </div>
            {/* The rail carries the rest. Showing the featured artifact again as
                the first card would read as a duplicate rather than as the same
                feed seen twice — the list below is where the whole window is
                repeated, deliberately and in full. */}
            <ArtifactRail items={recent.slice(1)} />
            <PackageRows items={recent.slice(0, LIST_ROWS)} />
          </>
        )}
      </section>
      {/* What used to be the submit form's job — telling a visitor how a
          repository gets in here — stated as the policy it actually is. Every
          number and every condition below is the same one the code enforces:
          the star floor is imported, not retyped, and the other three come
          straight from discoveryRejection's own ordering. */}
      <section aria-labelledby="policy-heading">
        <div className="section-head">
          <h2 id="policy-heading">How a repository gets indexed</h2>
        </div>
        <p className="section-lede">
          AgentDock discovers repositories on its own, twice a day. There is no submission form:
          nothing is added by request.
        </p>
        {/* The four conditions, joined to what they decide.

              They used to be four bordered columns with nothing above or below
              them, which left a reader to work out for themselves what the four
              were conditions *for*. The rail names both ends: a repository
              AgentDock has found goes in, and a repository AgentDock reads
              comes out.

              The rail is a bracket, not an arrow, and the line under it says so
              in words. All four have to hold; there is no first one, no order
              between them, and nothing here is a stage a repository passes
              through — src/corpus/policy.ts evaluates them as one predicate,
              and a chain of arrows would have drawn a pipeline that does not
              exist.

              One glyph per condition, so four conditions read as four kinds of
              thing at a glance instead of as four short paragraphs. Each is the
              ordinary sign for the noun it labels and none of them is a status
              light: no tick, no cross, no green, no red. Nothing here says a
              repository that fails a condition is worse than one that passes —
              only that AgentDock did not read it. */}
        <div className="gate">
          <p className="gate-end">
            <RepoIcon /> A repository AgentDock has found
          </p>
          <dl className="stats">
            <div>
              <dt>
                <StarIcon /> Stars
              </dt>
              <dd>
                {MIN_REPOSITORY_STARS}+<small>on GitHub, at the time it is first read</small>
              </dd>
            </div>
            <div>
              <dt>
                <GlobeIcon /> Visibility
              </dt>
              <dd>
                Public<small>private repositories are unreadable, not excluded</small>
              </dd>
            </div>
            <div>
              <dt>
                <ForkIcon /> Not a fork
              </dt>
              <dd>
                Upstream only<small>the original is what gets read</small>
              </dd>
            </div>
            <div>
              <dt>
                <ArchiveIcon /> Not archived
              </dt>
              <dd>
                Active<small>an archive has no next commit</small>
              </dd>
            </div>
          </dl>
          <p className="gate-end gate-out">
            <DockIcon /> AgentDock reads it
          </p>
          <p className="gate-note">All four hold at once. They are conditions, not steps.</p>
        </div>
        {/* The one sentence that keeps the star floor from reading as a
              quality claim. It is a scheduling rule about a small request
              budget, and src/corpus/policy.ts says the same thing to the next
              person who reads the code. */}
        <p className="notice">
          <InfoIcon />
          <span>
            The star floor decides which unread repositories AgentDock spends its small GitHub
            request budget on first. It is a popularity signal used for scheduling, not a statement
            about any artifact.
          </span>
        </p>
      </section>
    </>
  );
}
