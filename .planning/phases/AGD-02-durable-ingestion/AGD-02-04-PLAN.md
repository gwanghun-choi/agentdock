---
phase: AGD-02-durable-ingestion
plan: 04
type: execute
wave: 3
depends_on: ["02-02"]
files_modified:
  - src/app/actions.ts
  - src/app/actions.test.ts
  - src/app/jobs/[id]/page.tsx
  - src/components/JobPanel.tsx
  - src/components/JobPanel.test.tsx
  - src/components/SubmitForm.tsx
  - src/app/r/[owner]/[repo]/page.tsx
  - src/db/queries/packages.ts
autonomous: true
requirements: [JOB-01, JOB-02, JOB-05, QUA-04]

estimate:
  tokens: 65000
  raw_tokens: 65000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Submitting a repository never opens a socket to GitHub during the request"
    - "Submitting the same repository twice sends the person to the same job rather than telling them off"
    - "A job page shows queued, running, or the terminal answer, and updates itself until there is nothing left to see"
    - "A finished job shows the breakdown of what changed rather than a count that reads as new writes"
    - "A job that found nothing says so plainly, and never reads as though something was indexed"
    - "A partial read is stated on the job page and on the repository page rather than implied complete"
    - "A failed job shows a readable reason and a control that starts a new one"
    - "A repository page says when AgentDock last looked, at which commit, and what it is currently doing about it"
  artifacts:
    - path: "src/app/actions.ts"
      provides: "The asynchronous submit and the requeue, both validating before a row exists"
      exports: ["submitRepo", "requeueJob", "SubmitState"]
      min_lines: 70
    - path: "src/components/JobPanel.tsx"
      provides: "Every rendered state of a job, as a pure component with no database and no router"
      exports: ["JobPanel", "counterLine"]
      min_lines: 90
    - path: "src/components/JobPanel.test.tsx"
      provides: "The rendered-state suite, running with no database so it stays visible in CI"
      min_lines: 90
    - path: "src/app/actions.test.ts"
      provides: "The submit path's success, duplicate, invalid and denylisted cases, asserting no request is made"
      min_lines: 80
  key_links:
    - from: "src/app/actions.ts"
      to: "src/db/queries/jobs.ts"
      via: "the only thing a submit does is validate and write a row"
      pattern: "enqueueJob"
    - from: "src/app/jobs/[id]/page.tsx"
      to: "src/components/JobPanel.tsx"
      via: "the page composes a pure panel with the refresher, so every rendered state is testable without a router"
      pattern: "JobPanel"
    - from: "src/app/r/[owner]/[repo]/page.tsx"
      to: "src/db/queries/jobs.ts"
      via: "the repository page reports what AgentDock is currently doing about this repository"
      pattern: "latestJobForTarget"
---

<objective>
Give the asynchronous submit somewhere to go, and make the answer it eventually
produces readable — including the two answers that are easy to render
dishonestly: a repository that contained nothing, and a read that was only
partial.

Purpose: making ingestion asynchronous moves the result away from the moment of
submission, and every honesty property Phase 1 built into the submit message has
to survive that move. A page that shows a finished job as "24 stored" repeats
the complaint this phase exists to fix; a page that shows a repository with no
skills the same way it shows one with twenty-four is a new one.

Output: a submit that enqueues and links, a job page that renders every state of
a job and refreshes itself until there is nothing left to see, and a repository
page that says when AgentDock last looked, at which commit, and what it is doing
about it now.

Honours the CONTEXT.md decisions that a duplicate submit is deduped rather than
rejected, that a run finding nothing is a succeeded job whose page must still say
plainly that nothing was found, that the re-index wording becomes an explicit
breakdown, and that a partial read is stated rather than implied complete.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/AGD-02-durable-ingestion/CONTEXT.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-01-PLAN.md
@.planning/phases/AGD-02-durable-ingestion/AGD-02-02-PLAN.md
@src/app/actions.ts
@src/components/SubmitForm.tsx
@src/app/r/[owner]/[repo]/page.tsx
@src/db/queries/packages.ts
@src/ingest/errors.ts
@src/app/globals.css
</context>

<decisions_made_while_planning>

**1. The counter breakdown lives on the job page, not on the submit result.**

The scope asked for the breakdown on the submit result, and asynchronous
submission makes that impossible rather than optional: at the moment the form
returns, nothing has been read yet and every counter would be a guess. The
breakdown appears where the result appears. The submit message says what it
truthfully knows — that the repository is queued, and where to watch it.

**2. A duplicate submit is deduped, not rejected.**

Telling a person they did something wrong when they did the ordinary thing, and
giving them nothing to click, is worse than sending them to the run that is
already happening. The page they land on shows that job's real state, so nothing
is concealed by the redirect.

One imprecision is accepted and gets a comment rather than a column: someone who
pushes a commit and immediately re-submits while a run is in flight is deduped
onto a run that read the older tree. The honest fix is a re-run-requested flag,
and it is not worth a column until somebody notices.

**3. The rendered states are a pure component, so they are testable with no
database and no router.**

The page reads two rows and composes a panel with the refresher. The panel takes
those rows as props and holds nothing. That is what lets every rendered state —
including the two dishonest-by-default ones — be asserted in a suite that runs
in CI, where there is neither a database nor a browser.

**4. A job that found nothing gets its own sentence, not a row of zeros.**

The counter breakdown is correct for a repository that had artifacts. Printing
it for one that had none produces a line of zeros that reads as a malfunction
rather than as an answer. That outcome renders one plain sentence instead.

**5. Retry needs no retry-specific code.**

A terminally failed job has left the active-job index, so submitting the same
repository mints a genuinely new job. The control on the job page is therefore a
form posting the same target to a small action — one that redirects as its last
statement, outside any catch, which is the shape the framework documents.

**6. The attempt count is rendered without a ceiling.**

The maximum lives in the retry policy, which is a later plan. Rendering "attempt
two" is true today and stays true whatever the ceiling becomes; rendering
"attempt two of three" would either import forward or hard-code a number that
can drift out of agreement with the policy.

</decisions_made_while_planning>

<reference>

## Reference A — the submit result and the requeue

```ts
// src/app/actions.ts — replacing the tracer's version of submitRepo's return,
// and adding the requeue below it.

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
  // did not navigate.
  redirect(result.kind === 'queued' ? `/jobs/${result.id}` : '/');
}
```

## Reference B — `src/components/JobPanel.tsx`

```tsx
import Link from 'next/link';
import type { JobView } from '@/db/queries/jobs';
import { requeueJob } from '@/app/actions';

type Attempt = NonNullable<JobView['attempt']>;

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
  if (a.parseFailed > 0) {
    parts.push(`${a.parseFailed} could not be parsed`);
  }
  return parts.join(' · ');
}

/** Pure: takes rows, holds nothing, reaches nothing. */
export function JobPanel({ job }: { job: JobView }) {
  const attempt = job.attempt;
  const waiting = job.status === 'queued' && job.nextAttemptAt > new Date();

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

      {attempt?.outcome === 'no_artifacts' ? (
        // Deliberately not the counter line. A row of zeros reads as a
        // malfunction; this is an answer about the repository.
        <p className="lede">
          AgentDock read this repository and found no SKILL.md files in it. It currently indexes
          Agent Skills only.
        </p>
      ) : null}

      {attempt && attempt.outcome !== 'no_artifacts' && job.status === 'succeeded' ? (
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
        <span>Requested {job.requestedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
        <span>Attempt {job.attempts}</span>
        {attempt?.commitSha ? <span>Commit {attempt.commitSha.slice(0, 7)}</span> : null}
      </p>

      {job.status === 'succeeded' && attempt?.outcome !== 'no_artifacts' ? (
        <p>
          <Link href={`/r/${job.target}`}>View repository</Link>
        </p>
      ) : null}

      {job.status === 'failed' ? (
        <form action={requeueJob}>
          <input type="hidden" name="repo" value={job.target} />
          <button type="submit">Try again</button>
        </form>
      ) : null}
    </>
  );
}
```

## Reference C — the page composes the panel with the refresher

```tsx
// src/app/jobs/[id]/page.tsx
  const done = job.status === 'succeeded' || job.status === 'failed';

  return (
    <>
      <JobPanel job={job} />
      <PollUntilDone done={done} />
    </>
  );
```

## Reference D — the repository page's freshness block

`repositorySummary` in `src/db/queries/packages.ts` gains `lastIngestedSha`, and
`RepositorySummary` gains the matching field.

```tsx
      <p className="row-meta">
        <span>
          Last read by AgentDock:{' '}
          {repository.scannedAt
            ? `${repository.scannedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
            : 'never'}
        </span>
        {repository.lastIngestedSha ? (
          <span>At commit {repository.lastIngestedSha.slice(0, 7)}</span>
        ) : null}
        {job && job.status !== 'succeeded' ? (
          <span>
            <Link href={`/jobs/${job.id}`}>
              {job.status === 'failed' ? 'The last read failed' : 'AgentDock is reading it now'}
            </Link>
          </span>
        ) : null}
      </p>
```

## Reference E — the submit form's one changed word

The form already renders the returned message and links to the returned target,
so the only change is the pending label: reading is no longer what the request
does.

```tsx
        <button type="submit" disabled={pending}>
          {pending ? 'Queuing…' : 'Index'}
        </button>
```

</reference>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Submit enqueues and nothing else — proven by the absence of a request</name>
  <files>src/app/actions.ts, src/app/actions.test.ts, src/components/SubmitForm.tsx</files>
  <behavior>
    - A valid repository returns a job id and a link to that job's page.
    - No request to any host is made during the call.
    - Submitting the same repository twice while the first is still queued returns the same job id.
    - Submitting the same repository once its job is running returns that same job's id.
    - A value that is not owner/repo returns the invalid-input message and creates no row.
    - A full URL is rejected the same way, with no row and no request.
    - A denylisted repository returns the denylist message and creates no row.
    - The requeue action starts a new job for a target whose previous job finished.
  </behavior>
  <action>
    Finish the submit copy as Reference A and add the requeue beside it, then
    write the suite.

    The load-bearing assertion is the negative one: stub the global fetch with a
    recorder and assert it was never called. That is what distinguishes an
    enqueue from an ingest, and it is the only way to prove the request returns
    without waiting for GitHub rather than merely appearing to.

    The requeue redirects, and the redirect must be the last statement and must
    sit outside every catch. The framework's own documentation records why: a
    redirect is a thrown control-flow exception, and a wrapping catch turns it
    into a form that submitted and did not navigate. Phase 1 hit this and wrote
    it down; do not rediscover it.

    Follow the existing database-test conventions — assign the test schema before
    importing anything that reads it, guard on the database URL, and use
    sentinel targets under a test owner, because the active-job index is unique
    on target and vitest runs files in parallel against one schema.

    Change one word in the form. The button said the request was reading a
    repository; it now says it is queuing one, because that is what it does.
  </action>
  <verify>
    <automated>bun run test src/app/actions.test.ts &amp;&amp; bun run typecheck &amp;&amp; bun run lint</automated>
  </verify>
  <done>All eight behaviours pass, including the assertion that no request is made during a submit. Invalid input, a full URL, and a denylisted repository each create no row.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Every state of a job, rendered honestly and asserted without a database</name>
  <files>src/components/JobPanel.tsx, src/components/JobPanel.test.tsx, src/app/jobs/[id]/page.tsx</files>
  <behavior>
    - A queued job says it is queued; one scheduled for later says when it will be tried again.
    - A running job says it is being read now.
    - A succeeded job with artifacts renders the five-part breakdown, with removed and unparseable shown only when non-zero.
    - A succeeded job whose run changed nothing renders every artifact as unchanged and none as new or updated.
    - A succeeded job that found nothing renders one plain sentence and does not render the breakdown.
    - A succeeded job whose read was partial states that plainly and states that nothing was removed because of it.
    - A failed job renders its stored reason and a control that starts a new run.
    - No rendered state contains a judgement word about the repository's safety.
    - The rendered markup contains no script element and no inline event attribute for any state, including one whose target and stored reason carry hostile characters.
  </behavior>
  <action>
    Write the panel as Reference B and reduce the page to Reference C.

    The split exists so this suite can run with no database and no browser: the
    panel takes two plain rows and holds nothing, so every state is a fabricated
    object rather than a fixture that has to be ingested first. That is what
    keeps these assertions visible in CI, where there is neither.

    Two states are the reason this task exists. A repository that contained
    nothing is a job that succeeded — AgentDock read it correctly and the answer
    is that there is nothing there — so it must not be shown as an error and must
    not be shown as a row of zeros either. And a partial read must say both
    halves: that the listing is incomplete, and that nothing was removed on
    account of it, because "we could not read it all" and "we deleted what we
    could not read" are the two sentences this phase spent a plan separating.

    Render every value as a text child. Do not add a raw-markup escape hatch —
    the boundary scanner fails the build on one, and the escaping suite from
    Phase 1 is what proves the framework's default is sufficient. Include a
    hostile target and a hostile stored reason in the suite so that proof covers
    this page too.

    Say nothing about whether the repository is safe. No score, no grade, no
    verdict word — the footer's standing disclaimer is the only claim this
    project makes about safety and this page adds none.
  </action>
  <verify>
    <automated>bun run test src/components/JobPanel.test.tsx &amp;&amp; CI=1 bun run test src/components/JobPanel.test.tsx &amp;&amp; bun run typecheck</automated>
  </verify>
  <done>All nine rendered states pass, the suite runs with no database, a hostile target and reason render inert, and the found-nothing state renders its own sentence rather than a breakdown.</done>
</task>

<task type="auto">
  <name>Task 3: The repository page says when AgentDock last looked, at what, and what it is doing now</name>
  <files>src/app/r/[owner]/[repo]/page.tsx, src/db/queries/packages.ts</files>
  <action>
    Add the last-ingested commit to the repository summary query and its type,
    and render the freshness block as Reference D. Read the repository's most
    recent job through the query the queue already exposes, and link to it only
    when there is something to say — a job still queued or running, or one that
    failed. A succeeded job adds nothing the timestamp does not already say.

    Keep the existing partial-read notice exactly as it is. It is already
    correct, and after this phase it is also more often correct, because the
    stored flag is no longer paired with a listing that quietly lost rows.

    Render the commit as a short prefix beside the timestamp rather than as a
    second link. The permalink on each artifact already resolves to the exact
    file at the exact commit; a second link to the same commit at the repository
    level is a duplicate a reader has to disambiguate.

    Do not add a page listing all jobs. Nothing in this phase's requirements asks
    for one, a repository has one job worth looking at and it is linked from
    here, and a job has its own page reachable from the submit result.
  </action>
  <verify>
    <automated>bun run typecheck &amp;&amp; bun run lint &amp;&amp; bun run test &amp;&amp; bun run build &amp;&amp; bun run ci</automated>
  </verify>
  <done>The repository page shows the last-looked timestamp, the commit it was read at, and a link to a job that is queued, running or failed. The partial-read notice is unchanged. `bun run ci` and `bun run build` both pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| a direct POST → `submitRepo` and `requeueJob` | A server function is reachable without the form above it, so both validate before a row exists. |
| a stored attempt reason → a rendered page | Whatever is in that column will be shown to somebody, which is why its only source is the fixed message table. |
| a repository's own name → rendered markup | The target came from a person and is rendered on a page. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-02-18 | Tampering | `submitRepo` and `requeueJob` reached directly | high | mitigate | Both normalise the value before touching the queue, so an unvalidated string never becomes a target; the enqueue itself carries the denylist and depth guards. |
| T-02-19 | Tampering | stored reason and target rendered on the job page | high | mitigate | Every value is a text child, the raw-markup escape hatch is rejected by the boundary scanner, and the suite includes a hostile target and a hostile reason. |
| T-02-20 | Spoofing | a page reading as an assurance | high | mitigate | No score, no grade and no verdict word anywhere on the page; a run that found nothing renders one plain sentence and never reads as a successful index. |
| T-02-21 | Repudiation | a partial read presented as complete | high | mitigate | The panel states both that the listing is incomplete and that nothing was removed on account of it, and the repository page keeps its existing notice. |
| T-02-22 | Denial of Service | the requeue control as a free enqueue button | medium | mitigate | It routes through the same enqueue, so the depth ceiling and the active-job index both apply; a repeated press dedupes onto the job it just created. |
</threat_model>

<verification>
1. A submit returns a job id and its link, and makes no request to any host.
2. A duplicate submit, queued or running, returns the same job id.
3. Invalid input, a full URL, and a denylisted repository each create no row.
4. Every job state renders: queued, scheduled for later, running, succeeded with artifacts, succeeded with nothing found, succeeded but partial, and failed.
5. The found-nothing state renders one plain sentence and no breakdown.
6. The partial state says the listing is incomplete and that nothing was removed because of it.
7. A failed state renders its stored reason and a control that starts a new run.
8. No state contains a judgement word about safety, a script element, or an inline event attribute — including with a hostile target and reason.
9. The repository page shows the last-looked timestamp, the commit, and a link to a queued, running or failed job.
10. `bun run ci` and `bun run build` pass, and the panel suite runs with no database.
</verification>

<success_criteria>
- **JOB-01** — the submit path returns a job id without opening a socket, proven by an assertion that no request was made.
- **JOB-02** — every state of a job is observable on its own page, and the page refreshes itself until the job is terminal.
- **JOB-05** — a failed job shows the readable reason it stored, and a control that starts a new run through the same enqueue.
- **QUA-04** — the submit surface has integration tests over its success, duplicate, invalid and refused paths.
- ROADMAP criterion 1 — submitting returns immediately and the job can be watched.
- ROADMAP criterion 5, presentation half — a failed job shows a readable reason and can be retried.
- The Phase 1 re-index wording complaint is answered on the page where the result now appears.
</success_criteria>

<output>
Create `.planning/phases/AGD-02-durable-ingestion/02-04-SUMMARY.md` when done.
Record: the exact sentence rendered for a run that found nothing, the exact
breakdown line rendered for an unchanged re-index, and the wording of the partial
read notice. Record no credential.
</output>
