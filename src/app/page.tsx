import Link from 'next/link';
import { type CSSProperties, type ReactNode, Suspense } from 'react';
import { ArtifactYard } from '@/components/ArtifactYard';
import { DockBoard } from '@/components/DockBoard';
import { DockBoardStatic } from '@/components/DockBoardStatic';
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
import { DECLARING_FILES, IndexFlow } from '@/components/IndexFlow';
import { KindArt } from '@/components/KindArt';
import { LANGUAGE_LABELS } from '@/components/language';
import { PackageRows } from '@/components/PackageRows';
import { RowsPlaceholder } from '@/components/RowsPlaceholder';
import { FieldClear } from '@/components/SearchLauncher';
import { TYPE_FILTER_IDS, TYPE_FILTER_LABELS } from '@/components/typeFilters';
import { USAGE_GUIDES } from '@/components/usageGuide';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import { type HomeData, readHomeData } from '@/db/queries/homeSnapshot';
import { HIDDEN_UNLESS_ASKED } from '@/db/queries/language';
import { errorCode } from '@/ingest/errors';
import { log } from '@/log';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

/**
 * How long the first byte waits for the data. Inside it the page goes out whole, with
 * no boundary at all: no placeholder to replace, nothing to shift, and complete with
 * JavaScript off, which a streamed boundary is not (its content stays hidden there).
 * An async component under Suspense emits its fallback even when its promise has
 * already resolved (measured: 5 pending boundaries at an 18 ms first byte), hence
 * the two branches in `withHome`. Past it the words and the search box go first and the data follows in the stream,
 * which is the visit where the database is waking and the wait is seconds
 * (Phase 91: 5.4 to 13.7 s after 8 minutes idle). A failure inside it is still a 500
 * from the page. A later one cannot be: the status has gone out, so the page says so in
 * its own markup (`failed` in withHome), and release.mjs's smoke looks for the chips and
 * not only for the status.
 */
const FIRST_BYTE_BUDGET_MS = 400;

/**
 * How long the stream holds a boundary open for the data. Above the slowest wake measured
 * (13.7 s, as above) and under postgres.js's 30 s connect timeout, which is what would
 * otherwise end the wait, with nothing shown until then.
 */
const DATA_DEADLINE_MS = 20_000;

/** The data's half of a boundary: a function, so each caller keeps its own markup. */
async function WithHome({
  home,
  failed,
  children,
}: {
  home: Promise<HomeData | null>;
  failed: ReactNode;
  children: (data: HomeData) => ReactNode;
}) {
  const data = await home;
  return data ? children(data) : failed;
}

/** The chips' links work from the first byte; their counts arrive with the data. */
function TypeChips({ total, byType }: { total: number | null; byType: Record<string, number> }) {
  const pending = total === null;
  return (
    <nav aria-label="Artifact types" className="hero-types facet">
      <div className="facet-chips">
        <Link className="chip" href="/artifacts">
          All <span className="chip-count">{pending ? '' : total.toLocaleString('en-US')}</span>
        </Link>
        {TYPE_FILTER_IDS.map((id) => (
          <Link className="chip" href={`/artifacts?type=${id}`} key={id}>
            {TYPE_FILTER_LABELS[id]}{' '}
            <span className="chip-count">
              {pending ? '' : (byType[id] ?? 0).toLocaleString('en-US')}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

/**
 * What each kind is, for a reader who knows what they want but not its name: six boxes stacked as
 * the window comes down, each on its kind's own ground, with its kind's own drawing. Each is the
 * same URL as the hero's chip for it. The words are the type's documented definition from
 * usageGuide.ts, the same one its detail pages print: what the kind is, never how good any one of
 * them is. Catalogs have no entry: the search route does not filter on them, so there is no page
 * to send a reader to. `byType` is null until the data arrives, and the kinds then keep the chips'
 * order.
 */
function KindStack({ byType }: { byType: Record<string, number> | null }) {
  // The first box goes to the kind with the most listed. A stable sort: kinds with the same count
  // stay in the chips' order. This orders six kinds; no artifact is ordered by it.
  const byCount = byType
    ? [...TYPE_FILTER_IDS].sort((a, b) => (byType[b] ?? 0) - (byType[a] ?? 0))
    : TYPE_FILTER_IDS;
  return (
    <ol className="type-grid">
      {byCount.map((id, i) => {
        const listed = (byType?.[id] ?? 0).toLocaleString('en-US');
        return (
          <li className={`kind-slot hue-${id}`} key={id} style={{ '--i': i } as CSSProperties}>
            <Link
              className={`type-card hue-${id}`}
              data-tilt=""
              href={`/artifacts?type=${id}`}
              style={{ '--digits': listed.length } as CSSProperties}
            >
              <span className="type-inner">
                <span className="type-name">{TYPE_FILTER_LABELS[id]}</span>
                <span className="type-count">
                  {!byType ? (
                    '\u00a0'
                  ) : byType[id] ? (
                    <>
                      <strong>{listed}</strong> listed
                    </>
                  ) : (
                    'None listed yet'
                  )}
                </span>
                <span className="type-what">{USAGE_GUIDES[id]?.what}</span>
                {/* The files the detectors match for this kind: IndexFlow's list. */}
                <span className="type-files">
                  {DECLARING_FILES.filter(([, kind]) => kind === id).map(([file]) => (
                    <code key={file}>{file}</code>
                  ))}
                </span>
                <span className="type-go">
                  Browse them <ArrowRightIcon />
                </span>
              </span>
              <KindArt kind={id} />
            </Link>
            {/* A plain link: a prefetch would spend a read on a redirect nobody asked for. */}
            <a className="kind-random" href={`/artifacts/random?type=${id}`} rel="nofollow">
              Open one at random
            </a>
          </li>
        );
      })}
    </ol>
  );
}

const sumOf = (byType: Record<string, number>) =>
  Object.values(byType).reduce((sum, n) => sum + n, 0);

export default async function HomePage() {
  // The feed and the counts leave out HIDDEN_UNLESS_ASKED, as /artifacts does with
  // no `lang`, so every number on a chip is the total the page it links to opens on,
  // as of the last sync that finished whole (homeSnapshot.ts).
  const home = readHomeData();
  const ready = await Promise.race([
    home,
    new Promise<null>((resolve) => setTimeout(resolve, FIRST_BYTE_BUDGET_MS, null)),
  ]);
  // Past the first byte a failure is a state of the page, not an exception: thrown here it
  // reaches app/error.tsx, which replaces the search box and the chips as well, and needs
  // JavaScript to say anything. The one read shared by every boundary, so one log line.
  const late = ready
    ? null
    : Promise.race([
        home,
        new Promise<never>((_, reject) =>
          setTimeout(reject, DATA_DEADLINE_MS, new Error('deadline')),
        ),
      ]).catch((error: Error) => {
        log({
          event: 'home_unavailable',
          reason: error.message === 'deadline' ? 'deadline' : 'failed',
          code: errorCode(error),
        });
        return null;
      });
  const withHome = (
    fallback: ReactNode,
    render: (data: HomeData) => ReactNode,
    failed: ReactNode = fallback,
  ) =>
    ready ? (
      render(ready)
    ) : (
      <Suspense fallback={fallback}>
        <WithHome failed={failed} home={late as Promise<HomeData | null>}>
          {render}
        </WithHome>
      </Suspense>
    );
  const hiddenLabel = HIDDEN_UNLESS_ASKED.map((l) => LANGUAGE_LABELS[l]).join(' and ');

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
              <FieldClear />
            </span>
            <button type="submit">Search</button>
          </form>

          {/* The other way in, beside the box: every kind the index holds, with
              how many it lists. Each is the URL the artifacts page's own Type
              chip produces and each count is that page's total on arrival, as of the
              last sync that finished whole. The chips are the artifacts page's
              chips, in the same scrolled row on a phone. */}
          {withHome(<TypeChips byType={{}} total={null} />, ({ visible }) => (
            <TypeChips byType={visible} total={sumOf(visible)} />
          ))}
        </div>

        {/* Empty docks until the data arrives: the same box, so nothing moves, and no
            figure that could be read as a count. The scene starts with the real one. */}
        {withHome(
          <div aria-hidden="true" className="dock-board" data-scene="still">
            <DockBoardStatic counts={{}} />
          </div>,
          ({ visible }) => (
            <DockBoard
              blurbs={Object.fromEntries(
                TYPE_FILTER_IDS.map((id) => [id, USAGE_GUIDES[id]?.what ?? '']),
              )}
              counts={visible}
            >
              <DockBoardStatic counts={visible} />
            </DockBoard>
          ),
        )}

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
        {withHome(
          <>
            {/* No id: the streamed heading has it, and with JavaScript off both stay. */}
            <div className="section-head">
              <h2>Recently indexed</h2>
            </div>
            {/* Only when the data missed the budget and nothing can swap it in. A stream
                needs a script to show what arrives, so the skeleton goes as well
                (globals.css, `scripting: none`): it would otherwise promise rows forever. */}
            <noscript>
              <p className="board-scope">
                The index is taking longer than usual to answer, and this page cannot fill in by
                itself with JavaScript off. <a href="/">Reload</a> in a few seconds, or{' '}
                <Link href="/artifacts">browse all artifacts</Link>.
              </p>
            </noscript>
            <div className="home-pending">
              <RowsPlaceholder />
            </div>
          </>,
          ({ recent, visible, hidden, lastSync }) => {
            const total = sumOf(visible);
            // Exact rather than approximate: the repository this artifact came
            // from was read on this date. Not "the corpus was read on" — that is
            // a different claim and this page does not have the number for it.
            const newestRead = recent[0]?.scannedAt?.toISOString().slice(0, 10) ?? null;
            return (
              <>
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
                        Browse all {total.toLocaleString('en-US')} artifacts <ArrowRightIcon />
                      </Link>
                    </p>
                  ) : null}
                </div>
                {hidden > 0 ? (
                  <p className="board-scope">
                    Not listed by default: {hidden.toLocaleString('en-US')}{' '}
                    {hidden === 1 ? 'artifact' : 'artifacts'} with a description written in{' '}
                    {hiddenLabel}. <Link href="/artifacts?lang=any">List every language</Link>
                  </p>
                ) : null}
                {/* Empty only when nothing is listed in any language: with hidden rows
            the line above already says where they are. */}
                {recent.length > 0 ? (
                  <PackageRows items={recent} preview />
                ) : hidden === 0 ? (
                  <div className="empty">
                    <p className="muted">
                      Nothing indexed yet. The scheduled sync fills this the next time it runs.
                    </p>
                  </div>
                ) : null}
              </>
            );
          },
          // No counts and no rows: nothing here could be read, and an old figure would
          // look like a current one. Search and the links above do not depend on this read.
          <>
            <div className="section-head">
              <h2 id="recent-heading">Recently indexed</h2>
            </div>
            <div className="empty home-unavailable" role="alert">
              <p className="muted">
                AgentDock could not read its index just now, so the newest artifacts and the counts
                are missing from this page.
              </p>
              <p className="actions">
                <a className="btn" href="/">
                  Try again
                </a>
                <Link className="btn btn-quiet" href="/artifacts">
                  Browse all artifacts <ArrowRightIcon />
                </Link>
              </p>
            </div>
          </>,
        )}
      </section>

      <section aria-labelledby="types-heading" className="types stage">
        <div className="section-head">
          <h2 id="types-heading">Six kinds of file. Each does something else.</h2>
          <p className="section-lede">
            Everything in the index is one of these, recognised by the file that declares it.
          </p>
        </div>
        {withHome(<KindStack byType={null} />, ({ visible }) => (
          <KindStack byType={visible} />
        ))}
      </section>

      <section aria-labelledby="yard-heading" className="yard-section stage">
        <div className="section-head">
          <h2 id="yard-heading">The yard, as it stands</h2>
        </div>
        {withHome(<ArtifactYard total={null} />, ({ visible }) => (
          <ArtifactYard total={sumOf(visible)} />
        ))}
        <noscript>
          <p className="muted">
            This map needs JavaScript. <Link href="/artifacts">Browse all artifacts</Link> holds the
            same rows.
          </p>
        </noscript>
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
          {/* What the index holds, hidden languages included: the flow's count says
              "indexed", and these are indexed, only not listed by default. */}
          {withHome(<IndexFlow total={null} />, ({ visible, hidden, recent }) => (
            <IndexFlow sha={recent[0]?.commitSha} total={sumOf(visible) + hidden} />
          ))}
        </div>
      </section>

      {/* The four conditions, joined to what they decide.

          The two ends are named: a repository AgentDock has found goes in, and a
          repository AgentDock reads comes out. No arrow runs between them, and the
          line under them says so in words. All four have to
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
            <div className="floor">
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
    </>
  );
}
