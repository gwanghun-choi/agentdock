import Link from 'next/link';
import { DockBoard } from '@/components/DockBoard';
import { DockBoardStatic, DockStack } from '@/components/DockBoardStatic';
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
import { LANGUAGE_LABELS } from '@/components/language';
import { PackageRows } from '@/components/PackageRows';
import { TYPE_FILTER_IDS, TYPE_FILTER_LABELS } from '@/components/typeFilters';
import { USAGE_GUIDES } from '@/components/usageGuide';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import { HIDDEN_UNLESS_ASKED } from '@/db/queries/language';
import { countVisibleByType, listPackages } from '@/db/queries/packages';
import { lastSyncSucceededAt } from '@/db/queries/syncState';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

// The ten rows the board has always listed, from the one `listPackages` call
// this page makes.
const LIST_ROWS = 10;

export default async function HomePage() {
  // Both the feed and the counts leave out HIDDEN_UNLESS_ASKED, as /artifacts
  // does with no `lang`, so every number on a chip is the total the page it
  // links to opens on.
  const [recent, { visible: byType, hidden }, lastSync] = await Promise.all([
    listPackages({ limit: LIST_ROWS, hiddenLanguages: HIDDEN_UNLESS_ASKED }),
    countVisibleByType(HIDDEN_UNLESS_ASKED),
    lastSyncSucceededAt(),
  ]);
  // The listing total is the sum of the per-type counts — one grouped query
  // where countPackages() used to be, so this page still makes three.
  const total = Object.values(byType).reduce((sum, n) => sum + n, 0);
  // What the index holds, hidden languages included: the flow's count says
  // "indexed", and these are indexed, only not listed by default.
  const indexed = total + hidden;
  const hiddenLabel = HIDDEN_UNLESS_ASKED.map((l) => LANGUAGE_LABELS[l]).join(' and ');
  // Exact rather than approximate: the repository this artifact came from was
  // read on this date. Not "the corpus was read on" — that is a different claim
  // and this page does not have the number for it.
  const newestRead = recent[0]?.scannedAt?.toISOString().slice(0, 10) ?? null;
  // The bento's largest tile goes to the kind with the most listed. A stable sort:
  // kinds with the same count stay in the chips' order. This sizes a picture of
  // the corpus; no artifact is ordered by it.
  const byCount = [...TYPE_FILTER_IDS].sort((a, b) => (byType[b] ?? 0) - (byType[a] ?? 0));

  return (
    <>
      {/* Description, then the one action. The action used to be a form that
          indexed whatever repository a visitor typed; AgentDock has no accounts
          and no operator review, so that was an unauthenticated way to spend a
          shared 60-request budget and to put any repository at all into the
          index. Searching is what this page is for now, so that is the control.

          The pipeline diagram is not between the search box and the first
          artifact any more: there, the first artifact started at y=1,232 on a
          1280×800 screen and y=2,236 on a 390×844 phone (local seed,
          2026-10-26). The Latest read figure that followed it drew the first
          row below it a second time; the column holds the dock board instead,
          whose stacks are the same counts the chips print. */}
      <section className="hero">
        <div className="hero-copy">
          <h1>Find agent artifacts, and see where they came from.</h1>
          <p className="lede">
            Skills, plugins, MCP servers, commands, hooks and subagents, read from established
            public repositories and linked to the exact commit.
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

          {/* The other way in, beside the box: every kind the index holds, with
              how many it lists. Each is the URL the artifacts page's own Type
              chip produces and each count is that page's total on arrival — the
              same grouped query this page already made for the tiles further
              down (countVisibleByType), so this adds no query. The chips are
              the artifacts page's chips, in the same scrolled row on a phone. */}
          <nav aria-label="Artifact types" className="hero-types facet">
            <div className="facet-chips">
              <Link className="chip" href="/artifacts">
                All <span className="chip-count">{total.toLocaleString('en-US')}</span>
              </Link>
              {TYPE_FILTER_IDS.map((id) => (
                <Link className="chip" href={`/artifacts?type=${id}`} key={id}>
                  {TYPE_FILTER_LABELS[id]}{' '}
                  <span className="chip-count">{(byType[id] ?? 0).toLocaleString('en-US')}</span>
                </Link>
              ))}
            </div>
          </nav>
        </div>

        <DockBoard
          blurbs={Object.fromEntries(
            TYPE_FILTER_IDS.map((id) => [id, USAGE_GUIDES[id]?.what ?? '']),
          )}
          counts={byType}
        >
          <DockBoardStatic counts={byType} />
        </DockBoard>

        {/* Three facts about what AgentDock does. Each is enforced somewhere in
            the codebase — the discovery gate below states the first at length,
            AGENTS.md's "AgentDock reads; it never runs" is the second, and
            permalink()'s commit sha is the third. Never a claim about an
            artifact: only about what AgentDock does. */}
        <ul className="trust">
          <li>Public repositories only, never by request</li>
          <li>Files are read, never executed</li>
          <li>Linked to the exact commit that was read</li>
        </ul>
      </section>

      {/* The feed, as the rows a reader reads.

          It was drawn three times from one 18-row query: the newest artifact as
          a large card, the next seventeen as an auto-scrolling rail, then the
          first ten again as these rows — so the newest artifact appeared on the
          page twice and nine others twice, and the rows a reader can actually
          scan started 1,600px into the page on a phone. Every fact the card and
          the rail carried is on a row: the type, the name, the repository, the
          description, the path, the stars, the read date and the source link.
          The window figures beside the card (distinct repositories and kinds
          among the 18) described a window, not the corpus, and the
          per-type counts the page does have are in the hero. */}
      <section aria-labelledby="recent-heading" className="board stage">
        <div className="section-head">
          <h2 id="recent-heading">Recently indexed</h2>
          {recent.length > 0 ? (
            <p className="board-meta">
              {recent.length} most recent
              {newestRead ? ` · newest read ${newestRead}` : ''}
              {/* When a scheduled sync last reached its end with every stage
                  intact (corpus-sync.mjs). Absent until one has: a green job
                  that stopped half way does not write it. "Without errors",
                  not "complete": every run stops at its caps and leaves work
                  queued (AGENTS.md: every cap says what it dropped). */}
              {lastSync
                ? ` · last sync without errors ${lastSync.toISOString().slice(0, 16).replace('T', ' ')} UTC`
                : ''}
            </p>
          ) : null}
          {recent.length > 0 ? (
            <p className="board-actions">
              {/* The listing's two other date orders, each a URL the sort
                  chips on /artifacts produce. The page there says what each
                  date is a date of. */}
              <Link href="/artifacts?sort=added">Newly added</Link>
              <Link href="/artifacts?sort=changed">Content changed</Link>
              <Link href="/artifacts">
                Browse all {total} artifacts <ArrowRightIcon />
              </Link>
            </p>
          ) : null}
        </div>
        {hidden > 0 ? (
          <p className="board-scope">
            Not listed by default: {hidden.toLocaleString('en-US')}{' '}
            {hidden === 1 ? 'artifact' : 'artifacts'} with a description written in {hiddenLabel}.{' '}
            <Link href="/artifacts?lang=any">List every language</Link>
          </p>
        ) : null}
        {/* Empty only when nothing is listed in any language: with hidden rows
            the line above already says where they are. */}
        {recent.length > 0 ? (
          <PackageRows items={recent} />
        ) : hidden === 0 ? (
          <div className="empty">
            <p className="muted">
              Nothing indexed yet. The scheduled sync fills this the next time it runs.
            </p>
          </div>
        ) : null}
      </section>

      {/* What used to be the submit form's job — telling a visitor how a
          repository gets in here — stated as the policy it actually is. */}
      <section aria-labelledby="policy-heading" className="pipeline stage">
        {/* Pinned while the reader scrolls through it, where the browser can tie
            animation to scrolling and the window is at least 64×44rem. Everything is on screen and lit without that. */}
        <div className="pipeline-pin">
          <div className="section-head">
            <h2 id="policy-heading">How a repository gets indexed</h2>
            <p className="section-lede">
              AgentDock discovers repositories on its own, twice a day. There is no submission form:
              nothing is added by request.
            </p>
          </div>
          {/* The pipeline: what happens to a repository once it is found, before
              the conditions for finding it. */}
          <IndexFlow total={indexed} />
        </div>
      </section>

      {/* The four conditions, joined to what they decide.

          The two ends are named: a repository AgentDock has found goes in, and a
          repository AgentDock reads comes out. The rail between them is a bracket,
          not an arrow, and the line under it says so in words. All four have to
          hold; there is no first one, no order between them, and nothing here is
          a stage a repository passes through: src/corpus/policy.ts evaluates them
          as one predicate, and a chain of arrows would draw a pipeline that does
          not exist.

          The stars are drawn larger than the other three because they are a
          different kind of condition: a fork, an archive and a private repository
          are facts GitHub reports, the floor is AgentDock's own budget decision
          (policy.ts). The sentence that keeps it from reading as a quality claim
          stands beside the number. Size here is not rank.

          One glyph per condition, each the ordinary sign for its noun and none of
          them a status light: no tick, no cross, no green, no red. Nothing says a
          repository that fails a condition is worse than one that passes, only
          that AgentDock did not read it. Every number and condition is the one
          the code enforces: the star floor is imported, not retyped, and the other
          three come straight from discoveryRejection (policy.ts). */}
      <section aria-labelledby="gate-heading" className="conditions">
        <div className="section-head">
          <h2 id="gate-heading">What decides which repositories it reads</h2>
        </div>
        <div className="gate">
          <p className="gate-end">
            <RepoIcon /> A repository AgentDock has found
          </p>
          <dl className="stats">
            <div className="floor stage">
              <dt>
                <StarIcon /> Stars
              </dt>
              <dd>
                {MIN_REPOSITORY_STARS}+<small>on GitHub, at the time it is first read</small>
              </dd>
              <dd className="notice">
                <InfoIcon />
                <span>
                  The star floor decides which unread repositories AgentDock spends its small GitHub
                  request budget on first. It is a popularity signal used for scheduling, not a
                  statement about any artifact.
                </span>
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
      </section>

      {/* What each kind is, for a reader who knows what they want but not its
          name. Each tile is the same URL as the hero's chip for it, and its stack
          is the hero's stack for the same count (dockBoard.ts, plates()). What the
          tile adds is the type's documented definition from usageGuide.ts, the
          same one its detail pages print: what the kind is, never how good any one
          of them is. Catalogs have no entry: the search route does not filter on
          them, so there is no page to send a reader to. */}
      <section aria-labelledby="types-heading" className="types stage">
        <div className="section-head">
          <h2 id="types-heading">Browse by type</h2>
        </div>
        <ul className="type-grid">
          {byCount.map((id) => (
            <li key={id}>
              <Link className={`type-card hue-${id}`} href={`/artifacts?type=${id}`}>
                <DockStack count={byType[id] ?? 0} kind={id} />
                <span className="type-name">{TYPE_FILTER_LABELS[id]}</span>
                <span className="type-count">
                  {byType[id] ? (
                    <>
                      <strong>{byType[id].toLocaleString('en-US')}</strong> listed
                    </>
                  ) : (
                    'None listed yet'
                  )}
                </span>
                <span className="type-what">{USAGE_GUIDES[id]?.what}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
