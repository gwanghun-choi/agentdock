import { eq, isNull, sql } from 'drizzle-orm';
import { ANALYZERS } from '@/analyze';
import { analyzeArtifact } from '@/analyze/run';
import { db } from '@/db/client';
import { capabilityFinding, packageTable, packageVersion } from '@/db/schema';

/**
 * Re-runs the shipped analyzers over one stored version's own bytes.
 *
 * Reads package_version.body and .frontmatter, and package.sourcePath and
 * .meta, from the database and never touches GitHub — which is the whole
 * point: a detector rule change must be replayable across the index without
 * spending any of a 60-per-hour budget. src/ingest/pipeline.ts's
 * runAnalysis() is the only other caller of analyzeArtifact, and it runs
 * over bytes just fetched from GitHub; this function runs the identical
 * pass (the same ANALYZERS registry, the same analyzeArtifact) over bytes
 * already sitting in package_version and package.
 *
 * Lossy, and the loss is permanent rather than a bug to fix here. body is a
 * 32 KB excerpt (PRV-07), so content past the cut was never stored anywhere
 * and a detector added later cannot retroactively see it — two of the
 * eighty-four sampled real files are affected (CONTEXT.md Measurement 3).
 * Declared-capability re-analysis is NOT lossy: frontmatter is stored whole
 * under a 256 KB cap and the largest real block is ~1.2 KB. The two halves
 * have different guarantees and this comment does not blur them.
 *
 * Replaces rather than appends: this version's findings are deleted and
 * rewritten in one transaction, so a rule change cannot leave a page showing
 * both the old finding and the new one — a partial replace would leave it
 * showing neither.
 *
 * The file inventory is NOT recomputed here. It lives on `package`, derived
 * from a tree this function does not have and does not fetch; inventing one
 * from nothing would be worse than leaving the one the last scan wrote.
 *
 * Returns the number of findings written for this version (0 is a valid,
 * honest answer, not a failure) — the backfill script sums this across every
 * version it touches to report what re-analysis actually produced.
 */
export async function analyzePackageVersion(packageVersionId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        commitSha: packageVersion.commitSha,
        body: packageVersion.body,
        frontmatter: packageVersion.frontmatter,
        sourcePath: packageTable.sourcePath,
        meta: packageTable.meta,
      })
      .from(packageVersion)
      .innerJoin(packageTable, eq(packageVersion.packageId, packageTable.id))
      .where(eq(packageVersion.id, packageVersionId))
      .limit(1);

    if (!row) {
      throw new Error(`analyzePackageVersion: no package_version with id ${packageVersionId}`);
    }

    // AnalyzeInput.files stays [] here, the same as the ingest path
    // (pipeline.ts's runAnalysis) — no analyzer registered reads it yet, and
    // the real inventory is package.files, a separate column this function
    // does not touch.
    const pass = analyzeArtifact(ANALYZERS, {
      sourcePath: row.sourcePath,
      body: row.body ?? '',
      frontmatter: row.frontmatter,
      meta: row.meta,
      files: [],
    });

    await tx
      .delete(capabilityFinding)
      .where(eq(capabilityFinding.packageVersionId, packageVersionId));

    let written = 0;
    if (pass.findings.length > 0) {
      const inserted = await tx
        .insert(capabilityFinding)
        .values(
          pass.findings.map((f) => ({
            packageVersionId,
            detectorId: f.detectorId,
            detectorVersion: f.detectorVersion,
            category: f.category,
            signal: f.signal,
            summary: f.summary,
            sourcePath: f.sourcePath,
            startLine: f.startLine,
            endLine: f.endLine,
            commitSha: row.commitSha,
            evidenceText: f.evidenceText,
            metadata: f.metadata,
          })),
        )
        // A single analyzeArtifact pass can itself produce two
        // structurally-identical findings (persist.ts's own documented case:
        // a line matching the same detector pattern twice, e.g. "npm
        // install" appearing twice on skills/docx/SKILL.md:21) — the delete
        // above already cleared this version's OLD rows, so this conflict is
        // never against a previous run, only within this one pass. The array
        // must name the same six columns, in the same order, as
        // capability_finding_identity — persist.ts:210-221's convention.
        .onConflictDoNothing({
          target: [
            capabilityFinding.packageVersionId,
            capabilityFinding.detectorId,
            capabilityFinding.category,
            capabilityFinding.sourcePath,
            capabilityFinding.startLine,
            capabilityFinding.summary,
          ],
        })
        .returning({ id: capabilityFinding.id });
      written = inserted.length;
    }

    // Set even when zero findings exist — "analyzed, nothing found" is a
    // stored state distinct from "never analyzed" (CAP-11), the same
    // discipline persist.ts already applies on the ingest path.
    await tx
      .update(packageVersion)
      .set({ analyzedAt: sql`now()` })
      .where(eq(packageVersion.id, packageVersionId));

    // The count of rows actually written, not analyzeArtifact's raw output
    // length — the two can differ when one pass matches the same tuple twice
    // (skills/docx/SKILL.md:21's "npm install" appearing on the line twice,
    // per 04-01's own documented case), and onConflictDoNothing collapses
    // that pair to one row.
    return written;
  });
}

/**
 * Every package_version whose analyzed_at is still null — the entire corpus
 * ingested before this phase shipped, per CONTEXT.md Binding decision 9:
 * Phase 2's (package_id, content_hash) idempotency means re-ingesting an
 * unchanged repository mints no new version row and therefore no findings,
 * so this is the only path that ever reaches that existing corpus.
 *
 * Bounded by `limit` so a first run against a large index is a script
 * someone can actually run, not an unbounded loop nobody dares start.
 */
export async function unanalyzedVersionIds(limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: packageVersion.id })
    .from(packageVersion)
    .where(isNull(packageVersion.analyzedAt))
    .orderBy(packageVersion.id)
    .limit(limit);
  return rows.map((r) => r.id);
}
