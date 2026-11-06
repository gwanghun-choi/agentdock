/**
 * A commit, drawn: one bar per hex digit of the sha AgentDock read, its height the digit's value.
 * Nothing here is chosen or decorated, so two artifacts read at one commit print the same and no
 * two commits do, which is the one thing a picture on this site is allowed to claim. One path
 * rather than forty elements: a listing page draws twenty-five of these.
 */
export function commitBars(sha: string): number[] {
  return [...sha.toLowerCase()].flatMap((digit) => {
    const value = Number.parseInt(digit, 16);
    return Number.isNaN(value) ? [] : [value];
  });
}

const STEP = 4;
const MID = 18;

export function CommitPrint({ sha, className }: { sha: string; className?: string }) {
  const bars = commitBars(sha);
  const d = bars
    .map((value, i) => {
      const half = 2 + value;
      return `M${i * STEP + 1} ${MID - half}h2v${half * 2}h-2z`;
    })
    .join('');
  return (
    <svg
      aria-hidden="true"
      className={className ? `commit-print ${className}` : 'commit-print'}
      preserveAspectRatio="none"
      viewBox={`0 0 ${bars.length * STEP} ${MID * 2}`}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}
