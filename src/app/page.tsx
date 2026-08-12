import Link from 'next/link';
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
      <h1>AgentDock</h1>
      <p className="lede">
        An open index of agent artifacts. Paste a public GitHub repository and AgentDock reads the
        files that declare them, records what they declare, and links back to the exact file at the
        exact commit it read.
      </p>
      <p className="lede muted">
        It indexes skills, plugins, marketplaces, MCP servers, commands and hooks. What an artifact
        can actually do to your machine is disclosed later.
      </p>

      <SubmitForm />

      <h2>Request budget</h2>
      <p className="muted">
        AgentDock runs unauthenticated. GitHub allows it 60 requests an hour and each repository
        costs two, so roughly thirty repositories an hour.{' '}
        {rate
          ? `${rate.remaining} of ${rate.limit} were left after its most recent request.`
          : 'It has not called GitHub since this server started.'}
      </p>

      <h2>Recently indexed</h2>
      {recent.length === 0 ? (
        <p className="muted">Nothing indexed yet. Submit a repository above.</p>
      ) : (
        <>
          <PackageRows items={recent} />
          <p className="pager">
            <Link href="/skills">Browse all {total} artifacts</Link>
          </p>
        </>
      )}
    </>
  );
}
