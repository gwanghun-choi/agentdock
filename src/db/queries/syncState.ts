import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { schemaMeta } from '@/db/schema';

/**
 * Where one acquisition source stopped, and how far it can honestly claim to
 * have seen.
 *
 * The two fields advance independently, and that separation is the whole point:
 * the registry orders by server NAME and treats `updated_since` as a filter over
 * the entire name space, so a sweep that stopped at its page cap has seen a
 * prefix of the names and nothing else. Advancing a timestamp on the strength of
 * a prefix hides every later name whose last update predates it — permanently,
 * because each run would push the timestamp further forward. Measured live:
 * `?limit=100` ends at `ai.ankimcp`, and the same query filtered by a watermark
 * returns `ai.analyticslegends` through `io.oxylabs`, straight past the alphabet
 * the capped run never reached.
 */
export type SweepState = {
  /** Where to resume. Null when no pass is in flight. */
  cursor: string | null;
  /**
   * Only ever written by a pass that reached the end of the name space, and it
   * means exactly one thing: every name had been seen at least once as of this
   * moment. A pass that stopped early leaves it untouched.
   */
  watermark: string | null;
  /** When the in-flight pass began. Becomes the watermark when it completes. */
  passStartedAt: string | null;
};

const EMPTY: SweepState = { cursor: null, watermark: null, passStartedAt: null };

/**
 * schema_meta, whose doc calls it key/value facts about this deployment. Widened
 * here to carry acquisition sweep state, because the alternative is a column and
 * this phase adds no migration — and because a sweep's resume point genuinely is
 * a fact about this deployment rather than about any one row.
 */
function keyFor(source: string): string {
  return `corpus_sweep:${source}`;
}

export async function readSweepState(source: string): Promise<SweepState> {
  const [row] = await db
    .select({ value: schemaMeta.value })
    .from(schemaMeta)
    .where(eq(schemaMeta.key, keyFor(source)))
    .limit(1);
  if (!row) return { ...EMPTY };

  try {
    const parsed = JSON.parse(row.value) as Partial<SweepState>;
    return {
      cursor: typeof parsed.cursor === 'string' ? parsed.cursor : null,
      watermark: typeof parsed.watermark === 'string' ? parsed.watermark : null,
      passStartedAt: typeof parsed.passStartedAt === 'string' ? parsed.passStartedAt : null,
    };
  } catch {
    // A value nobody can read is treated as no state at all: the next run walks
    // the name space from the start, which over-fetches on a host that costs no
    // GitHub quota. The other direction would skip.
    return { ...EMPTY };
  }
}

export async function writeSweepState(source: string, state: SweepState): Promise<void> {
  const value = JSON.stringify(state);
  await db
    .insert(schemaMeta)
    .values({ key: keyFor(source), value })
    .onConflictDoUpdate({
      target: schemaMeta.key,
      set: { value, updatedAt: new Date() },
    });
}
