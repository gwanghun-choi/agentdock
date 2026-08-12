import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ANALYZERS } from '@/analyze';
import { fileInventory } from '@/analyze/files';
import { analyzeArtifact } from '@/analyze/run';
import { db } from '@/db/client';
import { repositoryDenylist } from '@/db/schema';
import { DETECTORS } from '@/detect';
import { assignParentPaths } from '@/detect/nesting';
import { collectCandidates, type DetectorPass, orderedNeeds, safeParse } from '@/detect/run';
import { GitHubError, normalizeRepo, rateLimitState } from '@/github/client';
import { fetchRepoScanInputs } from '@/github/scan';
import { log } from '@/log';
import { type AttemptOutcome, type IngestOutcome, messageFor, toIngestOutcome } from './errors';
import {
  type DiffCounters,
  type JobContext,
  lastIngestedSha,
  persistScan,
  touchRepository,
} from './persist';
import type { RepoScan, ScannedPackage, ScannedSeed } from './types';

/** PRV-07: an excerpt with attribution, never a mirror. */
const MAX_BODY = 32 * 1024;

export type IngestResult =
  | {
      ok: true;
      /** `unchanged` means the commit had not moved, so no file was read. */
      outcome: 'ok' | 'unchanged';
      owner: string;
      repo: string;
      fullName: string;
      commitSha: string;
      found: number;
      stored: number;
      failed: number;
      /** Repositories a catalog named. 0 on the `unchanged` short circuit. */
      seeds: number;
      truncated: boolean;
      counters: DiffCounters;
    }
  | {
      ok: false;
      outcome: IngestOutcome;
      message: string;
      /**
       * UTC epoch seconds, present only when GitHub said so. Carried out here so
       * the worker does not derive the same fact a second way — the catch block
       * already extracts it to build the message.
       */
      resetAt?: number;
    };

/**
 * Version identity, defined once.
 *
 * The raw bytes, with only line endings normalized: a commit that changes nothing
 * but line endings must not mint a version, and anything else must. Hashing the
 * parsed object instead would make identity depend on key ordering and on the
 * YAML loader's type coercion, so a dependency bump would mint a new version for
 * every row in the database.
 */
export function contentHash(raw: string): string {
  return createHash('sha256').update(raw.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Pure work, so it runs here — in the loop that already holds the body,
 * alongside contentHash — and never inside persistScan's transaction, where
 * it would hold a connection open across up to 400 artifacts for nothing.
 *
 * `files` is empty for every AnalyzeInput in this plan: no analyzer this
 * phase reads it yet, and the real inventory (src/analyze/files.ts) is
 * written separately, onto `package`, not carried through here.
 *
 * An analyzer that throws is isolated by analyzeArtifact itself; what this
 * wrapper adds is surfacing that failure the same way a detector's match()
 * failure already is — one line in detectorErrors, id and message only,
 * never the body (T-04-03).
 */
function runAnalysis(
  sourcePath: string,
  body: string,
  frontmatter: Record<string, unknown>,
  meta: Record<string, unknown>,
  detectorErrors: string[],
) {
  const pass = analyzeArtifact(ANALYZERS, { sourcePath, body, frontmatter, meta, files: [] });
  for (const [id, message] of Object.entries(pass.errors)) {
    detectorErrors.push(`analyze:${id}: ${message}`);
  }
  return pass.findings;
}

export async function ingestRepository(
  input: string,
  job?: Omit<JobContext, 'rateRemaining'>,
): Promise<IngestResult> {
  const started = Date.now();

  const normalized = normalizeRepo(input);
  if (!normalized) {
    // Rejected before a socket opens. This is the trust boundary, not a form hint.
    return { ok: false, outcome: 'invalid_input', message: messageFor('invalid_input') };
  }
  const { owner, repo } = normalized;
  const fullName = `${owner}/${repo}`;

  /**
   * The one line this ingestion emits, on whichever path it ends.
   *
   * Every field defaults, so a failure path states zero counters rather than
   * omitting them — a missing key and a genuine zero read the same in a log
   * aggregator, and only one of them is true.
   */
  const emit = (fields: {
    outcome: AttemptOutcome;
    commitSha?: string | null;
    found?: number;
    stored?: number;
    failed?: number;
    counters?: DiffCounters;
    /** Catalog entries that named no ingestible repository. Zero on every path
     * that read no catalog, never absent. */
    seedsSkipped?: number;
    truncated?: boolean;
    /** Present only when a detector threw, so a clean run's line is unchanged. */
    detectorErrors?: string[];
  }) => {
    const rate = rateLimitState();
    log({
      event: 'ingest',
      jobId: job?.id ?? null,
      attempt: job?.attemptNo ?? null,
      owner,
      repo,
      commitSha: fields.commitSha ?? null,
      outcome: fields.outcome,
      found: fields.found ?? 0,
      stored: fields.stored ?? 0,
      failed: fields.failed ?? 0,
      new: fields.counters?.new ?? 0,
      updated: fields.counters?.updated ?? 0,
      unchanged: fields.counters?.unchanged ?? 0,
      removed: fields.counters?.removed ?? 0,
      seedsSkipped: fields.seedsSkipped ?? 0,
      truncated: fields.truncated ?? false,
      durationMs: Date.now() - started,
      rateRemaining: rate?.remaining ?? null,
      rateReset: rate?.reset ?? null,
      detectorErrors:
        fields.detectorErrors && fields.detectorErrors.length > 0
          ? fields.detectorErrors
          : undefined,
    });
  };

  const [blocked] = await db
    .select()
    .from(repositoryDenylist)
    .where(eq(repositoryDenylist.fullName, fullName.toLowerCase()))
    .limit(1);
  if (blocked) {
    emit({ outcome: 'denylisted' });
    return { ok: false, outcome: 'denylisted', message: messageFor('denylisted') };
  }

  try {
    // Matched on the lowercased full name, which is how every other lookup in
    // this codebase matches. A renamed repository misses and takes the full
    // path, which is correct: a rename is exactly when the stored row and the
    // fetched one need reconciling.
    const known = await lastIngestedSha(fullName);

    // The needs callback captures the pass and the candidate loop below reuses
    // it, instead of calling match() a second time over the same bounded tree.
    // Two guards for one logical operation could diverge; one guarded pass
    // cannot.
    let passes: DetectorPass[] = [];

    // One place decides which paths are worth reading, and it reads paths only —
    // so a repository with no artifacts costs zero file fetches.
    const inputs = await fetchRepoScanInputs(
      owner,
      repo,
      (tree) => {
        passes = collectCandidates(DETECTORS, tree.entries);
        return orderedNeeds(passes);
      },
      known,
    );

    if (inputs.unchanged) {
      const touched = await touchRepository(
        inputs.metadata,
        inputs.tree.commitSha,
        new Date(),
        job ? { ...job, rateRemaining: rateLimitState()?.remaining ?? null } : undefined,
      );

      const counters: DiffCounters = {
        discovered: touched.liveCount,
        new: 0,
        updated: 0,
        unchanged: touched.liveCount,
        removed: 0,
        parseFailed: 0,
      };

      emit({
        outcome: 'unchanged',
        commitSha: inputs.tree.commitSha,
        found: touched.liveCount,
        stored: touched.liveCount,
        counters,
        truncated: touched.treeTruncated,
      });

      return {
        ok: true,
        outcome: 'unchanged',
        owner,
        repo,
        fullName: inputs.metadata.fullName,
        commitSha: inputs.tree.commitSha,
        found: touched.liveCount,
        stored: touched.liveCount,
        failed: 0,
        // The commit has not moved, so no file was read and no seed could have
        // been found on this pass — the same reason `found` is a live count
        // rather than a literal zero, this is a literal zero on purpose.
        seeds: 0,
        truncated: touched.treeTruncated,
        counters,
      };
    }

    // One generic pass over every candidate this repository's detectors
    // matched, linking a nested candidate to the nearest container a detector
    // marked with containerRoot (only plugin.ts, this phase). Runs once, after
    // every match() and before any parse(), and names no artifact type.
    assignParentPaths(passes.flatMap((p) => p.candidates));

    const read = async (path: string) => {
      const body = inputs.files.get(path);
      if (body === undefined) throw new Error('not read');
      return body;
    };

    const packages: ScannedPackage[] = [];
    const seeds: ScannedSeed[] = [];
    let failed = 0;
    // Summed across every catalog in the repository, and carried onto the log
    // line the same way seeds.length is carried onto the result below.
    let seedsSkipped = 0;
    // A detector that threw during match() contributes nothing and costs the
    // repository nothing else — recorded so a silent partial scan is at least
    // diagnosable.
    const detectorErrors: string[] = [];

    for (const pass of passes) {
      if (pass.error) detectorErrors.push(pass.error);

      for (const candidate of pass.candidates) {
        // A candidate with no needs is not a file to read — a shape-only match
        // declares needs: [] and still reaches parse(). Only a candidate that
        // asked for a file and did not get one was cut by a cap.
        const raw = candidate.needs.length > 0 ? inputs.files.get(candidate.needs[0]) : '';
        if (raw === undefined) continue; // a cap was reached; already counted as skipped

        // Per candidate, never per repository. One bad file must not lose the
        // other seventeen — and now a detector that throws from parse() costs
        // only this one candidate rather than the whole run.
        const result = await safeParse(pass.detector, candidate, read);
        const blobSha =
          inputs.tree.entries.find((e) => e.path === candidate.sourcePath)?.sha ?? null;
        // Free: the tree is already fully in memory, and this is a filter
        // over it, not a fetch. Written on every scan, not gated on a new
        // version — see ScannedPackage.files's own doc for why.
        const files = fileInventory(inputs.tree.entries, candidate.sourcePath);

        // Not an artifact and not a package — path-only match() could not know.
        if (result.status === 'none') continue;

        // A catalog names other repositories; route to the seed channel and
        // write no package row for it.
        if (result.status === 'seeds') {
          seedsSkipped += result.skipped;
          for (const seed of result.seeds) {
            seeds.push({
              fullName: seed.fullName,
              sourceKind: seed.sourceKind,
              discoveredFrom: fullName,
              discoveredPath: candidate.sourcePath,
              hint: seed.hint,
            });
          }
          continue;
        }

        if (!result.ok) {
          failed += 1;
          const body = raw.slice(0, MAX_BODY);
          packages.push({
            type: pass.detector.type,
            sourcePath: candidate.sourcePath,
            name: result.artifact?.name ?? candidate.sourcePath,
            slug: result.artifact?.slug ?? candidate.sourcePath,
            summary: null,
            licenseText: null,
            meta: {},
            blobSha,
            contentHash: contentHash(raw),
            declaredVersion: null,
            body,
            frontmatter: {},
            parseStatus: 'failed',
            parseErrors: result.errors,
            parentPath: candidate.parentPath ?? null,
            findings: runAnalysis(candidate.sourcePath, body, {}, {}, detectorErrors),
            files,
          });
          continue;
        }

        const body = result.artifact.body.slice(0, MAX_BODY);
        packages.push({
          type: pass.detector.type,
          sourcePath: candidate.sourcePath,
          name: result.artifact.name,
          slug: result.artifact.slug,
          summary: result.artifact.summary,
          licenseText: result.artifact.licenseText,
          meta: result.artifact.meta,
          blobSha,
          contentHash: contentHash(result.artifact.contentBasis ?? raw),
          declaredVersion: result.artifact.declaredVersion,
          body,
          frontmatter: result.artifact.frontmatter,
          parseStatus: result.status,
          parseErrors: result.warnings,
          parentPath: candidate.parentPath ?? null,
          findings: runAnalysis(
            candidate.sourcePath,
            body,
            result.artifact.frontmatter,
            result.artifact.meta,
            detectorErrors,
          ),
          files,
        });
      }
    }

    // A repository whose only artifact is a catalog found something. Reporting
    // it as empty would also discard the seeds it found.
    if (packages.length === 0 && seeds.length === 0) {
      // Still carried: a marketplace whose every entry was unreachable produces
      // no package and no seed, and that is exactly the run whose count matters.
      emit({
        outcome: 'no_artifacts',
        commitSha: inputs.tree.commitSha,
        seedsSkipped,
        detectorErrors,
      });
      return { ok: false, outcome: 'no_artifacts', message: messageFor('no_artifacts') };
    }

    const scan: RepoScan = {
      ...inputs.metadata,
      scannedAt: new Date(),
      commitSha: inputs.tree.commitSha,
      // Either the tree itself was cut short, or a cap stopped some files being
      // read. Both mean the same thing to a reader: this listing is incomplete.
      treeTruncated: inputs.tree.truncated || inputs.artifactsTruncated,
      packages,
      seeds,
    };

    // The rate figure comes from here, so the transaction never reaches into
    // the GitHub client.
    const persisted = await persistScan(
      scan,
      job ? { ...job, rateRemaining: rateLimitState()?.remaining ?? null } : undefined,
    );

    emit({
      outcome: 'ok',
      commitSha: scan.commitSha,
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      counters: persisted.counters,
      seedsSkipped,
      truncated: scan.treeTruncated,
      detectorErrors,
    });

    return {
      ok: true,
      outcome: 'ok',
      owner,
      repo,
      fullName: scan.fullName,
      commitSha: scan.commitSha,
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      seeds: seeds.length,
      truncated: scan.treeTruncated,
      counters: persisted.counters,
    };
  } catch (error) {
    const outcome = toIngestOutcome(error);
    const reset = error instanceof GitHubError ? error.rateLimit?.reset : undefined;
    emit({ outcome });
    // The exception itself never crosses this boundary.
    return { ok: false, outcome, message: messageFor(outcome, reset), resetAt: reset };
  }
}
