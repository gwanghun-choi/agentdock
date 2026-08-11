import type { AnalyzeInput, Analyzer, Finding } from './types';
import { ANALYZE_CAPS } from './types';

export type AnalyzePass = {
  findings: Finding[];
  /** analyzer id -> message. Never the body, never a matched line. */
  errors: Record<string, string>;
  /** analyzer id -> count of findings dropped once maxFindingsPerDetector was reached. */
  overflow: Record<string, number>;
  durationMs: number;
};

/**
 * The guarded analyzer pass.
 *
 * Copies both properties of src/detect/run.ts's collectCandidates: (a) an
 * analyzer that throws loses only its own findings, recorded as an error
 * keyed by its id — one analyzer's bug must not lose every other analyzer's
 * findings; (b) the analyzer list is a parameter rather than an imported
 * registry, which is what lets the CAP-13 measurement (04-02) run a
 * candidate pattern over the corpora without touching the shipped set.
 *
 * Isolation matters more here than in Phase 3: analysis runs inside
 * persistScan's transaction (src/ingest/persist.ts), so an unguarded throw
 * would roll back the package_version insert, the package upsert and the
 * job's terminal state — not just lose one analyzer's output.
 *
 * The analyzer id is its function's own name (install.name === 'install'),
 * the same identity Finding.detectorId carries — one name, not two.
 */
export function analyzeArtifact(analyzers: Analyzer[], input: AnalyzeInput): AnalyzePass {
  const start = performance.now();
  const findings: Finding[] = [];
  const errors: Record<string, string> = {};
  const overflow: Record<string, number> = {};

  // Defence-in-depth against a future uncapped caller, not the primary
  // control: the pipeline already slices every body to MAX_BODY before an
  // analyzer ever sees it (src/ingest/pipeline.ts), so this never fires on
  // real data.
  if (input.body.length > ANALYZE_CAPS.maxBodyChars) {
    errors._input = `body is ${input.body.length} chars, over the input cap of ${ANALYZE_CAPS.maxBodyChars}`;
    return { findings, errors, overflow, durationMs: performance.now() - start };
  }

  for (const analyzer of analyzers) {
    const id = analyzer.name || 'anonymous';
    try {
      const result = analyzer(input);
      if (result.length > ANALYZE_CAPS.maxFindingsPerDetector) {
        const withheld = result.length - ANALYZE_CAPS.maxFindingsPerDetector;
        overflow[id] = withheld;
        const kept = result.slice(0, ANALYZE_CAPS.maxFindingsPerDetector);
        findings.push(...kept);
        // The cheapest honest way to say a cap fired: one more finding, in
        // the same category as the analyzer's own kept output, whose summary
        // names the exact number withheld. A list showing 50 of however many
        // with nothing said is the quiet lie CAP-11 forbids — this way the
        // page renders the notice as an ordinary row without knowing it is
        // special (Reference B / CapabilityPanel.tsx).
        findings.push({
          detectorId: id,
          detectorVersion: kept[0].detectorVersion,
          category: kept[0].category,
          signal: 'cap',
          summary: `stopped after ${ANALYZE_CAPS.maxFindingsPerDetector} findings; ${withheld} more were found and withheld`,
          sourcePath: input.sourcePath,
          startLine: null,
          endLine: null,
          evidenceText: null,
          metadata: {},
        });
      } else {
        findings.push(...result);
      }
    } catch (error) {
      // Nothing else. The input's body never reaches this line, so a
      // distinctive marker planted in the body cannot appear in it — see
      // run.test.ts's isolation suite.
      errors[id] = (error as Error).message;
    }
  }

  return { findings, errors, overflow, durationMs: performance.now() - start };
}
