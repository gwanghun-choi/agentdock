import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requeueJob } from '@/app/actions';
import { JobPanel } from '@/components/JobPanel';
import { PollUntilDone } from '@/components/PollUntilDone';
import { getJobView } from '@/db/queries/jobs';

export const dynamic = 'force-dynamic';

// bigserial, so bounded above by the safe-integer range rather than by a guess.
const jobId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

type Props = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: Props) {
  const parsed = jobId.safeParse((await params).id);
  if (!parsed.success) notFound();

  const job = await getJobView(parsed.data);
  if (!job) notFound();

  const done = job.status === 'succeeded' || job.status === 'failed';

  return (
    <>
      <JobPanel
        job={job}
        // Supplied here rather than imported by the panel, so the panel stays a
        // component that reaches nothing and its suite stays runnable without a
        // database. Nothing retry-specific happens on the other side: a terminal
        // job has left the active-job index, so the same enqueue mints a new one.
        retry={
          <form action={requeueJob}>
            <input type="hidden" name="repo" value={job.target} />
            <button type="submit">Try again</button>
          </form>
        }
      />
      <PollUntilDone done={done} />
    </>
  );
}
