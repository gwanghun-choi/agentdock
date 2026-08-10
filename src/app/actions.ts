'use server';

import { revalidatePath } from 'next/cache';
import { ingestRepository } from '@/ingest/pipeline';

export type SubmitState = {
  status: 'idle' | 'ok' | 'error';
  message: string;
  href?: string;
  found?: number;
  stored?: number;
  failed?: number;
  truncated?: boolean;
};

/**
 * A server function is reachable by a direct request, not only through the form
 * above it — the framework documents this explicitly. Its validation is therefore
 * a trust boundary, and it is the same validation the pipeline applies, called
 * once, rather than a second copy that can drift.
 *
 * It returns its result rather than redirecting. The documented mutation shape is
 * a redirect, whose documented trap is that it throws a control-flow exception
 * any wrapping catch swallows silently — leaving a form that submitted and did
 * not navigate. Returning also keeps the counts this phase is asked to show. If a
 * redirect is ever added back it must sit outside every catch and be the last
 * statement.
 */
export async function submitRepo(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const raw = String(formData.get('repo') ?? '');
  const result = await ingestRepository(raw);

  if (!result.ok) return { status: 'error', message: result.message };

  revalidatePath('/');
  revalidatePath('/skills');
  revalidatePath(`/r/${result.owner}/${result.repo}`);

  return {
    status: 'ok',
    message:
      `Read ${result.fullName} at ${result.commitSha.slice(0, 7)}: ` +
      `${result.found} skill${result.found === 1 ? '' : 's'} found, ${result.stored} stored` +
      (result.failed > 0 ? `, ${result.failed} could not be parsed` : '') +
      (result.truncated ? '. The repository was larger than one pass, so this is partial' : '.'),
    href: `/r/${result.owner}/${result.repo}`,
    found: result.found,
    stored: result.stored,
    failed: result.failed,
    truncated: result.truncated,
  };
}
