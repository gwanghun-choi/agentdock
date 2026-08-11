import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { ANALYZERS } from '@/analyze';
import { ANALYZE_CAPS } from '@/analyze/types';
import { db } from '@/db/client';
import { capabilityFinding } from '@/db/schema';

export type CapabilityFindingView = {
  id: number;
  detectorId: string;
  category: string;
  signal: string;
  summary: string;
  sourcePath: string;
  startLine: number | null;
  endLine: number | null;
  evidenceText: string | null;
};

/**
 * cache() dedupes within one render pass, so the page and its
 * generateMetadata do not hit the database twice for the same rows.
 *
 * The limit is the guarded pass's own volume cap (ANALYZE_CAPS.maxFindingsPerDetector)
 * times the number of registered analyzers — bounded by construction, the
 * same reasoning packages.ts's getRepositoryPackages already gives for its
 * own limit rather than a page parameter.
 */
export const getCapabilityFindings = cache(
  async (packageVersionId: number): Promise<CapabilityFindingView[]> =>
    db
      .select({
        id: capabilityFinding.id,
        detectorId: capabilityFinding.detectorId,
        category: capabilityFinding.category,
        signal: capabilityFinding.signal,
        summary: capabilityFinding.summary,
        sourcePath: capabilityFinding.sourcePath,
        startLine: capabilityFinding.startLine,
        endLine: capabilityFinding.endLine,
        evidenceText: capabilityFinding.evidenceText,
      })
      .from(capabilityFinding)
      .where(eq(capabilityFinding.packageVersionId, packageVersionId))
      .orderBy(capabilityFinding.startLine)
      .limit(ANALYZE_CAPS.maxFindingsPerDetector * ANALYZERS.length),
);

/**
 * Splits one query's rows by category, so the generic "Observed in this
 * file" list and the dedicated Hidden Content panel (04-03) never render the
 * same row twice. A plain array filter, pure and DB-free, kept beside the
 * query it filters so the split convention cannot drift out of sync with
 * CAPABILITY_CATEGORIES.
 */
export function splitHiddenContent(findings: CapabilityFindingView[]): {
  hidden: CapabilityFindingView[];
  observed: CapabilityFindingView[];
} {
  return {
    hidden: findings.filter((f) => f.category === 'hidden_content'),
    observed: findings.filter((f) => f.category !== 'hidden_content'),
  };
}
