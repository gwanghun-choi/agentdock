import Link from 'next/link';
import type { ReactNode } from 'react';
import type { JobView } from '@/db/queries/jobs';

type Attempt = NonNullable<JobView['attempt']>;

const utc = (at: Date) => at.toISOString().slice(0, 16).replace('T', ' ');

/**
 * What the run did, as five facts rather than one number.
 *
 * "24 stored" reads as twenty-four writes on a run that wrote nothing, which is
 * the complaint this replaces.
 */
export function counterLine(a: Attempt): string {
  const parts = [
    `${a.artifactsFound} discovered`,
    `${a.artifactsNew} new`,
    `${a.artifactsUpdated} updated`,
    `${a.artifactsUnchanged} unchanged`,
  ];
  if (a.artifactsRemoved > 0) parts.push(`${a.artifactsRemoved} removed`);
  if (a.parseFailed > 0) parts.push(`${a.parseFailed} could not be parsed`);
  return parts.join(' · ');
}

/**
 * Every rendered state of a job.
 *
 * Pure: it takes two rows, holds nothing and reaches nothing — no database, no
 * router, no server function. That is what lets every state below, including the
 * two that are dishonest by default, be asserted in a suite that runs where
 * there is neither a database nor a browser.
 *
 * `retry` is a node rather than an imported server function for the same
 * reason: importing one would pull the database client in at module load and
 * this suite would stop running without a database, which is the whole point of
 * the split. The page supplies the control; this component decides when it is
 * shown.
 */
export function JobPanel({ job, retry }: { job: JobView; retry?: ReactNode }) {
  const attempt = job.attempt;
  const waiting = job.status === 'queued' && job.nextAttemptAt > new Date();
  const finished = job.status === 'succeeded' && attempt !== null;
  const foundNothing = attempt?.outcome === 'no_artifacts';

  return (
    <>
      <h1>{job.target}</h1>

      {job.status === 'queued' ? (
        <p className="lede">
          {waiting
            ? `Waiting until ${job.nextAttemptAt.toISOString().slice(11, 16)} UTC before trying again.`
            : 'Queued. AgentDock will start reading it shortly.'}
        </p>
      ) : null}
      {job.status === 'running' ? <p className="lede">Reading it now.</p> : null}

      {finished && foundNothing ? (
        // Deliberately not the counter line. A row of zeros reads as a
        // malfunction; this is an answer about the repository.
        <p className="lede">
          AgentDock read this repository and found no agent artifacts in it. It looks for skills,
          plugins, marketplaces, MCP servers, commands and hooks.
        </p>
      ) : null}

      {finished && !foundNothing ? (
        <>
          <p className="lede">{counterLine(attempt)}</p>
          {attempt.truncated ? (
            <p className="error">
              AgentDock read part of this repository, so this is not everything that is in it.
              Nothing was removed from the listing, because an incomplete read is not evidence that
              anything is gone.
            </p>
          ) : null}
        </>
      ) : null}

      {job.status === 'failed' && attempt?.errorDetail ? (
        <p className="error">{attempt.errorDetail}</p>
      ) : null}

      <p className="row-meta">
        <span>Requested {utc(job.requestedAt)} UTC</span>
        {/* No ceiling. The maximum lives in the retry policy; "attempt two of
            three" would either import forward or hard-code a number that can
            drift out of agreement with it. */}
        <span>Attempt {job.attempts}</span>
        {attempt?.commitSha ? <span>Commit {attempt.commitSha.slice(0, 7)}</span> : null}
      </p>

      {finished && !foundNothing ? (
        <p>
          <Link href={`/r/${job.target}`}>View repository</Link>
        </p>
      ) : null}

      {job.status === 'failed' ? retry : null}
    </>
  );
}
