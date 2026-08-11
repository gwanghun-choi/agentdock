import type { Candidate, Detector, ParseResult, TreeEntry } from './types';

/** One detector's candidates, kept grouped so the fetch cap can cut fairly. */
export type DetectorPass = {
  detector: Detector;
  candidates: Candidate[];
  /** Set when this detector's match() threw. Its candidates are then empty. */
  error: string | null;
};

/**
 * One guarded match pass over the registry.
 *
 * match() is documented as pure and the skill detector's is a filter+map that
 * cannot throw on any input. The detectors this phase adds group directories and
 * parse JSON, and they can. A detector that throws here loses its own candidates
 * and nothing else — one detector's bug must not lose every other detector's
 * findings for the repository.
 *
 * Takes the detector list as a parameter rather than importing DETECTORS, which
 * is what lets a test register a seventh detector without touching the registry.
 */
export function collectCandidates(detectors: Detector[], tree: TreeEntry[]): DetectorPass[] {
  return detectors.map((detector) => {
    try {
      return { detector, candidates: detector.match(tree), error: null };
    } catch (error) {
      return { detector, candidates: [], error: `${detector.type}: ${(error as Error).message}` };
    }
  });
}

/**
 * Every path the pass wants read, interleaved round robin across detectors.
 *
 * The caller truncates this at CAPS.maxFiles. Concatenating detector by detector
 * would make the cut depend on position in the DETECTORS array: on a large
 * repository the last detector would silently receive nothing, which no test
 * that uses a small tree can see. Round robin makes the cut proportional across
 * types instead.
 */
export function orderedNeeds(passes: DetectorPass[]): string[] {
  const queues = passes.map((p) => p.candidates.flatMap((c) => c.needs));
  const out: string[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i += 1) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/**
 * parse(), guarded.
 *
 * The comment at pipeline.ts's candidate loop says "per candidate, never per
 * repository" and has always been an intention rather than a mechanism:
 * isolation held only because skill.parse catches internally and returns
 * {ok:false}. A detector that throws is a bug, and it is recorded as a failed
 * candidate rather than allowed to become a failed repository.
 */
export async function safeParse(
  detector: Detector,
  candidate: Candidate,
  read: (path: string) => Promise<string>,
): Promise<ParseResult> {
  try {
    return await detector.parse(candidate, read);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      errors: [`${detector.type} detector threw: ${(error as Error).message}`],
    };
  }
}
