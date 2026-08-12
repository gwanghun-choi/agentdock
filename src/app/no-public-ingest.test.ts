import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AgentDock has no accounts, no sign-in and no operator review. Any endpoint
 * that lets an anonymous visitor name a repository and have it read is
 * therefore a way to spend a shared 60-requests-an-hour budget, to bypass the
 * discovery policy entirely, and to put anything at all into a public index —
 * with nobody to hold responsible for it.
 *
 * Two such endpoints existed and are gone: `submitRepo`, behind the home page's
 * index form, and `requeueJob`, behind the "Try again" button on a failed job.
 * The second is the reason this file is structural rather than a test of the
 * home page: the form that mattered was on a page nobody thought of as an
 * ingestion surface.
 *
 * A server function is reachable by direct POST whether or not any page renders
 * a form for it, so removing the form is not removing the endpoint. What this
 * asserts is that no server function exists at all — which is a property a
 * reviewer can check in one grep, and which no future page can quietly
 * reintroduce by importing something.
 *
 * This is deliberately NOT a rule in scripts/check-boundaries.mjs. That scanner
 * enforces invariants about what AgentDock may reach (hosts, disk, execution);
 * this is a product decision about what it accepts, and the day AgentDock grows
 * authentication it becomes wrong rather than violated.
 */

const ROOTS = ['src/app', 'src/components'];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const files = ROOTS.flatMap(sourceFiles);

describe('the public surface accepts no repository', () => {
  it('declares no server function anywhere under src/app or src/components', () => {
    const withDirective = files.filter((file) => {
      const head = readFileSync(file, 'utf8').slice(0, 200);
      return /^\s*(['"])use server\1/m.test(head);
    });
    expect(withDirective).toEqual([]);
  });

  // The two deleted modules by name. A file re-appearing under either name is
  // the specific regression, and naming them says what the general rule above
  // is actually protecting against.
  it.each(['src/app/actions.ts', 'src/components/SubmitForm.tsx'])('has no %s', (path) => {
    expect(files).not.toContain(path);
  });

  /**
   * enqueueJob itself must survive. It holds the denylist check and the
   * MAX_QUEUED ceiling, and the scheduled fan-out and refresh both go through
   * it — deleting the public entry point must not have deleted the queue.
   */
  it('still routes ingestion through enqueueJob, from the scheduler only', async () => {
    const callers = files.filter((file) => readFileSync(file, 'utf8').includes('enqueueJob'));
    expect(callers).toEqual([]);

    const { enqueueJob } = await import('@/db/queries/jobs');
    expect(typeof enqueueJob).toBe('function');
  });
});
