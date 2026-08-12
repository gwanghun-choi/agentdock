import Link from 'next/link';
import { ArrowRightIcon } from '@/components/Icon';
import { PackageRows } from '@/components/PackageRows';
import { SubmitForm } from '@/components/SubmitForm';
import { countPackages, listPackages } from '@/db/queries/packages';
import { rateLimitState } from '@/github/client';

// Read at request time. Nothing here may be prerendered: `next build` runs in
// CI, where there is no database.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [recent, total] = await Promise.all([listPackages({ limit: 10 }), countPackages()]);

  // The remaining allowance as of AgentDock's last GitHub request. Read from the
  // headers the client already saw rather than fetched: a page render that
  // depends on an upstream call is a page that a slow upstream can take down,
  // and the number here would be the same number.
  const rate = rateLimitState();

  return (
    <>
      {/* Description, then the one action. The previous page opened with two
          paragraphs of prose above the form; indexing a repository is what this
          page is for, so it sits directly under a single sentence. */}
      <section className="hero">
        <h1>Find agent artifacts, and see where they came from.</h1>
        <p className="lede">
          An open index of skills, plugins, marketplaces, MCP servers, commands and hooks. Paste a
          public GitHub repository and AgentDock reads the files that declare them, records what
          they declare, and links back to the exact file at the exact commit it read.
        </p>
      </section>

      <section className="card" aria-labelledby="index-heading">
        <h2 className="sr-only" id="index-heading">
          Index a repository
        </h2>
        <SubmitForm />
      </section>

      {/* The budget was a four-line paragraph. The numbers are the content, so
          they are the thing that is large; the sentence explaining them stays,
          because dropping it would make the numbers unreadable rather than
          compact. */}
      <section aria-labelledby="budget-heading">
        <div className="section-head">
          <h2 id="budget-heading">Request budget</h2>
        </div>
        <div className="card">
          <dl className="stats">
            <div>
              <dt>GitHub API</dt>
              <dd>
                Unauthenticated
                <small>no token configured</small>
              </dd>
            </div>
            <div>
              <dt>Allowance</dt>
              <dd>
                60<small>requests per hour</small>
              </dd>
            </div>
            <div>
              <dt>Capacity</dt>
              <dd>
                ~30<small>repositories per hour, at two requests each</small>
              </dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>
                {rate ? rate.remaining : '—'}
                <small>
                  {rate
                    ? `of ${rate.limit} after the most recent request`
                    : 'no call since startup'}
                </small>
              </dd>
            </div>
          </dl>
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
            <p className="muted">Nothing indexed yet. Submit a repository above to start.</p>
          </div>
        ) : (
          <PackageRows items={recent} />
        )}
      </section>
    </>
  );
}
