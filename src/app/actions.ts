'use server';

import { redirect } from 'next/navigation';
import { enqueueJob } from '@/db/queries/jobs';
import { normalizeRepo } from '@/github/client';
import { messageFor } from '@/ingest/errors';

export type SubmitState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  href?: string;
  jobId?: number;
};

/**
 * A server function is reachable by a direct request, not only through the form
 * above it. Its validation is therefore a trust boundary, and it runs before a
 * row exists rather than after.
 *
 * It returns rather than redirects, for the reason recorded in Phase 1: a
 * redirect throws a control-flow exception that any wrapping catch swallows,
 * leaving a form that submitted and did not navigate.
 */
export async function submitRepo(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const normalized = normalizeRepo(String(formData.get('repo') ?? ''));
  if (!normalized) return { status: 'error', message: messageFor('invalid_input') };

  const fullName = `${normalized.owner}/${normalized.repo}`;
  const result = await enqueueJob(fullName);

  if (result.kind === 'denylisted') {
    return { status: 'error', message: messageFor('denylisted') };
  }
  if (result.kind === 'flooded') {
    return {
      status: 'error',
      message:
        'AgentDock already has as many repositories waiting as it will hold. ' +
        'Try again once the queue has drained.',
    };
  }

  return {
    status: 'ok',
    message:
      `${fullName} is queued. AgentDock reads repositories in the background, ` +
      'so this page does not have to wait.',
    href: `/jobs/${result.id}`,
    jobId: result.id,
  };
}

/**
 * Starts a fresh run for a repository whose last one finished.
 *
 * There is no retry-specific path in the queue and there should not be: a
 * terminal job has left the active-job index, so this mints a new one, and a job
 * that is still queued or running dedupes onto itself.
 *
 * ponytail: dedupes onto the running job even when the caller has just pushed a
 * commit; add a re-run-requested flag the first time someone actually notices.
 */
export async function requeueJob(formData: FormData): Promise<void> {
  const normalized = normalizeRepo(String(formData.get('repo') ?? ''));
  if (!normalized) redirect('/');

  const result = await enqueueJob(`${normalized.owner}/${normalized.repo}`);
  // The last statement, outside every catch. A redirect throws a control-flow
  // exception, and a wrapping catch swallows it into a form that submitted and
  // did not navigate. Phase 1 hit this; it is not to be rediscovered.
  redirect(result.kind === 'queued' ? `/jobs/${result.id}` : '/');
}
