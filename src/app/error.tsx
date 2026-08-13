'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ArrowRightIcon } from '@/components/Icon';

/**
 * The route-segment error boundary.
 *
 * `'use client'` is not a design choice here — the framework requires an error
 * boundary to be a Client Component, because recovering means re-rendering the
 * segment from the browser and nothing on the server is still listening by the
 * time this renders. It is the only client component in this application that
 * exists for a framework requirement rather than for an interaction.
 *
 * Every page here reads PostgreSQL at request time, so the realistic cause is
 * that the database is unreachable, and the honest thing to say is that
 * AgentDock could not read its own index — not that the artifact is missing,
 * which is a different fact with its own page.
 *
 * `error.digest` is the framework's server-side correlation id and the only
 * part of the error a production build exposes to the browser at all: the
 * message and stack are replaced with a generic string before they leave the
 * server. Printing the digest gives an operator something to grep the logs for.
 * Nothing else about the error is rendered, deliberately — a database error
 * message can carry a hostname, a schema name or a connection string, and this
 * page is public.
 */
// Named RouteError, not Error: the framework takes this as a default export and
// does not care what it is called, and `function Error` shadows the global one
// inside its own module — which is a confusing thing to do in a file whose whole
// subject is an Error value.
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // The server already logged this. This is the browser's copy, so a reader
    // reporting the problem has the same digest in their own console.
    console.error(error);
  }, [error]);

  return (
    <>
      <div className="page-head">
        <h1>Something went wrong</h1>
        <p className="muted">
          AgentDock could not read its index to answer this request. Nothing was changed, and
          nothing is missing from the index because of it.
        </p>
      </div>
      <div className="empty">
        {error.digest ? (
          <p className="muted">
            Reference <code>{error.digest}</code>
          </p>
        ) : null}
        <p className="actions">
          <button type="button" className="btn" onClick={retry}>
            Try again
          </button>
          <Link className="btn btn-quiet" href="/">
            Go to the home page <ArrowRightIcon />
          </Link>
        </p>
      </div>
    </>
  );
}
