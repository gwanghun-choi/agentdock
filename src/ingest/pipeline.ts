import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { repositoryDenylist } from '@/db/schema';
import { DETECTORS } from '@/detect';
import { GitHubError, normalizeRepo, rateLimitState } from '@/github/client';
import { fetchRepoScanInputs } from '@/github/scan';
import { log } from '@/log';
import { type IngestOutcome, messageFor, toIngestOutcome } from './errors';
import { persistScan } from './persist';
import type { RepoScan, ScannedPackage } from './types';

/** PRV-07: an excerpt with attribution, never a mirror. */
const MAX_BODY = 32 * 1024;

export type IngestResult =
  | {
      ok: true;
      owner: string;
      repo: string;
      fullName: string;
      commitSha: string;
      found: number;
      stored: number;
      failed: number;
      truncated: boolean;
    }
  | { ok: false; outcome: IngestOutcome; message: string };

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

export async function ingestRepository(input: string): Promise<IngestResult> {
  const started = Date.now();

  const normalized = normalizeRepo(input);
  if (!normalized) {
    // Rejected before a socket opens. This is the trust boundary, not a form hint.
    return { ok: false, outcome: 'invalid_input', message: messageFor('invalid_input') };
  }
  const { owner, repo } = normalized;
  const fullName = `${owner}/${repo}`;

  const [blocked] = await db
    .select()
    .from(repositoryDenylist)
    .where(eq(repositoryDenylist.fullName, fullName.toLowerCase()))
    .limit(1);
  if (blocked) {
    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: null,
      outcome: 'denylisted',
      found: 0,
      stored: 0,
      failed: 0,
      durationMs: Date.now() - started,
      rateRemaining: null,
    });
    return { ok: false, outcome: 'denylisted', message: messageFor('denylisted') };
  }

  try {
    // One place decides which paths are worth reading, and it reads paths only —
    // so a repository with no artifacts costs zero file fetches.
    const inputs = await fetchRepoScanInputs(owner, repo, (tree) =>
      DETECTORS.flatMap((d) => d.match(tree.entries)).flatMap((c) => c.needs),
    );

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
      log({
        event: 'ingest',
        owner,
        repo,
        commitSha: inputs.tree.commitSha,
        outcome: 'no_artifacts',
        found: 0,
        stored: 0,
        failed: 0,
        durationMs: Date.now() - started,
        rateRemaining: rateLimitState()?.remaining ?? null,
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
    };

    const persisted = await persistScan(scan);

    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: scan.commitSha,
      outcome: 'ok',
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      durationMs: Date.now() - started,
      rateRemaining: rateLimitState()?.remaining ?? null,
    });

    return {
      ok: true,
      owner,
      repo,
      fullName: scan.fullName,
      commitSha: scan.commitSha,
      found: packages.length,
      stored: persisted.packageIds.length,
      failed,
      truncated: scan.treeTruncated,
    };
  } catch (error) {
    const outcome = toIngestOutcome(error);
    const reset = error instanceof GitHubError ? error.rateLimit?.reset : undefined;
    log({
      event: 'ingest',
      owner,
      repo,
      commitSha: null,
      outcome,
      found: 0,
      stored: 0,
      failed: 0,
      durationMs: Date.now() - started,
      rateRemaining: rateLimitState()?.remaining ?? null,
    });
    // The exception itself never crosses this boundary.
    return { ok: false, outcome, message: messageFor(outcome, reset) };
  }
}
