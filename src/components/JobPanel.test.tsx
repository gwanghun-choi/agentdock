import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JobView } from '@/db/queries/jobs';
import { counterLine, JobPanel } from './JobPanel';

/**
 * Every rendered state of a job, asserted with no database and no browser.
 *
 * The panel takes two plain rows and holds nothing, so each state below is a
 * fabricated object rather than a fixture that has to be ingested first. That is
 * what keeps these assertions visible in CI, where there is neither.
 */

type Attempt = NonNullable<JobView['attempt']>;

const COMMIT = 'f17010c9bb483898c1d9c9f42dde2b3a98889434';
const PAST = new Date('2026-08-10T09:00:00.000Z');
const FUTURE = new Date(Date.now() + 60 * 60 * 1000);

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 1,
    jobId: 1,
    attemptNo: 1,
    startedAt: PAST,
    finishedAt: PAST,
    outcome: 'ok',
    errorDetail: null,
    commitSha: COMMIT,
    filesRead: 18,
    artifactsFound: 18,
    artifactsNew: 18,
    artifactsUpdated: 0,
    artifactsUnchanged: 0,
    artifactsRemoved: 0,
    parseFailed: 0,
    truncated: false,
    rateRemaining: 55,
    rateReset: null,
    ...overrides,
  };
}

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: 1,
    target: 'anthropics/skills',
    status: 'queued',
    attempts: 1,
    requestedAt: PAST,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: PAST,
    attempt: null,
    ...overrides,
  };
}

const render = (view: JobView, retry?: React.ReactNode) =>
  renderToStaticMarkup(<JobPanel job={view} retry={retry} />);

const RETRY = (
  <form>
    <button type="submit">Try again</button>
  </form>
);

describe('a job that has not finished', () => {
  it('says it is queued', () => {
    const html = render(job());
    expect(html).toContain('Queued. AgentDock will start reading it shortly.');
    expect(html).toContain('Attempt 1');
  });

  it('says when a job scheduled for later will be tried again', () => {
    const html = render(job({ nextAttemptAt: FUTURE, attempts: 2 }));
    expect(html).toContain('before trying again');
    expect(html).toContain(FUTURE.toISOString().slice(11, 16));
    expect(html).not.toContain('will start reading it shortly');
    // Rendered without a ceiling, because the ceiling lives in the retry policy.
    expect(html).toContain('Attempt 2');
    expect(html).not.toMatch(/Attempt 2 of/);
  });

  it('says a running job is being read now', () => {
    const html = render(job({ status: 'running', startedAt: PAST }));
    expect(html).toContain('Reading it now.');
    expect(html).not.toContain('Queued.');
  });
});

describe('a job that succeeded', () => {
  const done = (a: Partial<Attempt>) =>
    job({ status: 'succeeded', finishedAt: PAST, attempt: attempt(a) });

  it('renders the breakdown rather than a single stored count', () => {
    const html = render(done({}));
    expect(html).toContain('18 discovered · 18 new · 0 updated · 0 unchanged');
    // The Phase 1 complaint, in its exact shape: a count that reads as writes.
    expect(html).not.toMatch(/\b18 stored\b/);
  });

  it('renders a re-index that changed nothing as every artifact unchanged', () => {
    const html = render(
      done({
        outcome: 'unchanged',
        filesRead: 0,
        artifactsNew: 0,
        artifactsUnchanged: 18,
      }),
    );
    expect(html).toContain('18 discovered · 0 new · 0 updated · 18 unchanged');
  });

  it('hides removed and unparseable counts until they are non-zero', () => {
    expect(counterLine(attempt())).not.toMatch(/removed|could not be parsed/);
    expect(counterLine(attempt({ artifactsRemoved: 2, parseFailed: 1 }))).toBe(
      '18 discovered · 18 new · 0 updated · 0 unchanged · 2 removed · 1 could not be parsed',
    );
  });

  it('says plainly that nothing was found, and renders no breakdown', () => {
    const html = render(
      done({
        outcome: 'no_artifacts',
        artifactsFound: 0,
        artifactsNew: 0,
        filesRead: 0,
      }),
    );

    // A run that found nothing is a job that succeeded — AgentDock read the
    // repository correctly and the answer is that there is nothing there.
    expect(html).toContain('found no SKILL.md files in it');
    expect(html).not.toContain('discovered');
    expect(html).not.toContain('0 new');
    // And it is not an index, so there is nothing to go and look at.
    expect(html).not.toContain('View repository');
  });

  it('states a partial read, and that nothing was removed on account of it', () => {
    const html = render(done({ truncated: true }));

    // Both halves. "We could not read it all" and "we deleted what we could not
    // read" are the two sentences this phase spent a plan separating.
    expect(html).toContain('not everything that is in it');
    expect(html).toContain('Nothing was removed from the listing');
  });

  it('links to the repository and shows the commit it was read at', () => {
    const html = render(done({}));
    expect(html).toContain('href="/r/anthropics/skills"');
    expect(html).toContain(`Commit ${COMMIT.slice(0, 7)}`);
    expect(html).not.toContain(COMMIT);
  });
});

describe('a job that failed', () => {
  const failed = (a: Partial<Attempt> = {}) =>
    job({
      status: 'failed',
      finishedAt: PAST,
      attempts: 3,
      attempt: attempt({
        outcome: 'unreadable',
        errorDetail: 'AgentDock could not read that repository.',
        commitSha: null,
        ...a,
      }),
    });

  it('renders the reason it stored and a control that starts a new run', () => {
    const html = render(failed(), RETRY);
    expect(html).toContain('AgentDock could not read that repository.');
    expect(html).toContain('Try again');
  });

  it('renders no breakdown and no repository link', () => {
    const html = render(failed(), RETRY);
    expect(html).not.toContain('discovered');
    expect(html).not.toContain('View repository');
  });

  it('shows the retry control only on a job that failed', () => {
    expect(render(job(), RETRY)).not.toContain('Try again');
    expect(render(job({ status: 'running' }), RETRY)).not.toContain('Try again');
  });
});

describe('what the page never says', () => {
  const everyState: JobView[] = [
    job(),
    job({ nextAttemptAt: FUTURE }),
    job({ status: 'running' }),
    job({ status: 'succeeded', attempt: attempt() }),
    job({ status: 'succeeded', attempt: attempt({ truncated: true }) }),
    job({ status: 'succeeded', attempt: attempt({ outcome: 'no_artifacts', artifactsFound: 0 }) }),
    job({ status: 'failed', attempt: attempt({ outcome: 'unavailable', errorDetail: 'x' }) }),
  ];

  it.each(everyState.map((v, i) => [i, v]))('states no verdict about safety (%i)', (_i, view) => {
    const html = render(view, RETRY);
    // The footer's standing disclaimer is the only claim this project makes
    // about safety, and this page adds none.
    expect(html).not.toMatch(
      /\bsafe\b|\bunsafe\b|verified|trusted|malicious|risk score|\bgrade\b/i,
    );
  });

  it.each(everyState.map((v, i) => [i, v]))('renders inert markup (%i)', (_i, view) => {
    const hostile = {
      ...view,
      target: '</h1><script>alert("xss-marker")</script>',
      attempt: view.attempt
        ? { ...view.attempt, errorDetail: '<img src=x onerror="alert(1)">' }
        : null,
    };

    const html = render(hostile, RETRY);

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    // A handler that survives as text is inert: the quote that would have
    // opened an attribute value is an entity, so nothing became markup.
    expect(html).not.toContain('onerror="');
    // The target is rendered in every state, so this holds for every state.
    expect(html).toContain('&lt;script&gt;');
  });
});
