import Link from 'next/link';
import { ArrowRightIcon, SearchIcon } from '@/components/Icon';

export const metadata = { title: 'Not found — AgentDock' };

/**
 * What `notFound()` renders. Three routes call it: an artifact path that is not
 * in the corpus, a repository that is not, and a job id that does not parse or
 * does not exist.
 *
 * Until this file existed those all fell through to the framework's built-in
 * page, which is styled by the framework and follows the operating system's
 * colour scheme rather than the surrounding layout — so the one moment a reader
 * hits a dead end was also the one moment the site stopped looking like itself.
 *
 * The wording is the same distinction the zero-result branch of the artifacts
 * route draws, and for the same reason: AgentDock's corpus is not the ecosystem,
 * and "AgentDock has not indexed this" is a fact about AgentDock while "this
 * does not exist" is a claim about the world that AgentDock is in no position to
 * make. The two exits offered are the two that can actually help — search the
 * corpus, or read what gets into it.
 */
export default function NotFound() {
  return (
    <>
      <div className="page-head">
        <h1>Not found</h1>
        <p className="muted">
          AgentDock has nothing at this address. That is not the same as the artifact or repository
          not existing — it may simply be one AgentDock has not read.
        </p>
      </div>
      <div className="empty">
        <p className="muted">
          A link may be out of date, or the path may name a file in a repository outside the corpus.
        </p>
        <p className="actions">
          <Link className="btn" href="/artifacts">
            <SearchIcon /> Search the index
          </Link>
          <Link className="btn btn-quiet" href="/">
            How a repository gets indexed <ArrowRightIcon />
          </Link>
        </p>
      </div>
    </>
  );
}
