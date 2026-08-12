import { notFound } from 'next/navigation';
import { z } from 'zod';
import { JobPanel } from '@/components/JobPanel';
import { PollUntilDone } from '@/components/PollUntilDone';
import { getJobView } from '@/db/queries/jobs';

export const dynamic = 'force-dynamic';

// bigserial, so bounded above by the safe-integer range rather than by a guess.
const jobId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

type Props = { params: Promise<{ id: string }> };

/**
 * A read-only view of one ingest run.
 *
 * No retry control any more, and JobPanel's `retry` slot is left empty rather
 * than filled with a disabled button. The control was a form posting an
 * arbitrary `repo` value to a server function, which made it a public endpoint
 * for enqueueing any repository on GitHub — the same hole the home page's index
 * form was, in the place nobody looked. Re-reading a repository is now the
 * scheduled sync's job and reaches this page as a new row.
 */
export default async function JobPage({ params }: Props) {
  const parsed = jobId.safeParse((await params).id);
  if (!parsed.success) notFound();

  const job = await getJobView(parsed.data);
  if (!job) notFound();

  const done = job.status === 'succeeded' || job.status === 'failed';

  return (
    <>
      <JobPanel job={job} />
      <PollUntilDone done={done} />
    </>
  );
}
