import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { repositoryDenylist } from '@/db/schema';
import { DETECTORS } from '@/detect';
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
import type { RepoScan, ScannedPackage } from './types';

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
    truncated?: boolean;
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
      truncated: fields.truncated ?? false,
      durationMs: Date.now() - started,
      rateRemaining: rate?.remaining ?? null,
      rateReset: rate?.reset ?? null,
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

    // One place decides which paths are worth reading, and it reads paths only —
    // so a repository with no artifacts costs zero file fetches.
    const inputs = await fetchRepoScanInputs(
      owner,
      repo,
      (tree) => DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs),
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
        truncated: touched.treeTruncated,
        counters,
      };
    }

    const read = async (path: string) => {
      const body = inputs.files.get(path);
      if (body === undefined) throw new Error('not read');
      return body;
    };

    const packages: ScannedPackage[] = [];
    let failed = 0;

    for (const detector of DETECTORS) {
      for (const candidate of detector.match(inputs.tree.entries)) {
        const raw = inputs.files.get(candidate.sourcePath);
        if (raw === undefined) continue; // a cap was reached; already counted as skipped

        // Per candidate, never per repository. One bad file must not lose the
        // other seventeen.
        const result = await detector.parse(candidate, read);
        const blobSha =
          inputs.tree.entries.find((e) => e.path === candidate.sourcePath)?.sha ?? null;

        if (!result.ok) {
          failed += 1;
          packages.push({
            type: detector.type,
            sourcePath: candidate.sourcePath,
            name: result.artifact?.name ?? candidate.sourcePath,
            slug: result.artifact?.slug ?? candidate.sourcePath,
            summary: null,
            licenseText: null,
            meta: {},
            blobSha,
            contentHash: contentHash(raw),
            declaredVersion: null,
            body: raw.slice(0, MAX_BODY),
            frontmatter: {},
            parseStatus: 'failed',
            parseErrors: result.errors,
          });
          continue;
        }

        packages.push({
          type: detector.type,
          sourcePath: candidate.sourcePath,
          name: result.artifact.name,
          slug: result.artifact.slug,
          summary: result.artifact.summary,
          licenseText: result.artifact.licenseText,
          meta: result.artifact.meta,
          blobSha,
          contentHash: contentHash(raw),
          declaredVersion: result.artifact.declaredVersion,
          body: result.artifact.body.slice(0, MAX_BODY),
          frontmatter: result.artifact.frontmatter,
          parseStatus: result.status,
          parseErrors: result.warnings,
        });
      }
    }

    if (packages.length === 0) {
      emit({ outcome: 'no_artifacts', commitSha: inputs.tree.commitSha });
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
      truncated: scan.treeTruncated,
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
