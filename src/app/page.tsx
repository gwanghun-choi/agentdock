import Link from 'next/link';
import { ArrowRightIcon, InfoIcon, SearchIcon } from '@/components/Icon';
import { PackageRows } from '@/components/PackageRows';
import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import { countPackages, listPackages } from '@/db/queries/packages';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [recent, total] = await Promise.all([listPackages({ limit: 10 }), countPackages()]);

  return (
    <>
      {/* Description, then the one action. The action used to be a form that
          indexed whatever repository a visitor typed; AgentDock has no accounts
          and no operator review, so that was an unauthenticated way to spend a
          shared 60-request budget and to put any repository at all into the
          index. Browsing is what this page is for now, so that is the button. */}
      <section className="hero">
        <h1>Find agent artifacts, and see where they came from.</h1>
        <p className="lede">
          An open index of skills, plugins, marketplaces, MCP servers, commands and hooks. AgentDock
          reads the files that declare them in established public repositories, records what they
          declare, and links back to the exact file at the exact commit it read.
        </p>
        <p className="actions">
          <Link className="btn" href="/artifacts">
            Browse artifacts <ArrowRightIcon />
          </Link>
          <Link className="btn btn-quiet" href="/artifacts?q=">
            <SearchIcon /> Search
          </Link>
        </p>
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
        <div className="card">
          <p>
            AgentDock discovers repositories on its own, twice a day, from a public registry, a
            curated seed list and GitHub&apos;s own topic search. There is no submission form:
            nothing is added by request.
          </p>
          <dl className="stats">
            <div>
              <dt>Stars</dt>
              <dd>
                {MIN_REPOSITORY_STARS}+<small>on GitHub, at the time it is first read</small>
              </dd>
            </div>
            <div>
              <dt>Visibility</dt>
              <dd>
                Public<small>private repositories are unreadable, not excluded</small>
              </dd>
            </div>
            <div>
              <dt>Not a fork</dt>
              <dd>
                Upstream only<small>the original is what gets read</small>
              </dd>
            </div>
            <div>
              <dt>Not archived</dt>
              <dd>
                Active<small>an archive has no next commit</small>
              </dd>
            </div>
          </dl>
          {/* The one sentence that keeps the star floor from reading as a
              quality claim. It is a scheduling rule about a small request
              budget, and src/corpus/policy.ts says the same thing to the next
              person who reads the code. */}
          <p className="notice">
            <InfoIcon />
            <span>
              The star floor decides which unread repositories AgentDock spends its small GitHub
              request budget on first. It is a popularity signal used for scheduling, not a
              statement about any artifact.
            </span>
          </p>
        </div>
      </section>

      <section aria-labelledby="recent-heading">
        <div className="section-head">
          <h2 id="recent-heading">Recently indexed</h2>
          {recent.length > 0 ? (
            <Link href="/artifacts">
              Browse all {total} artifacts <ArrowRightIcon />
            </Link>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <p className="muted">
              Nothing indexed yet. The scheduled sync fills this the next time it runs.
            </p>
          </div>
        ) : (
          <PackageRows items={recent} />
        )}
      </section>
    </>
  );
}
