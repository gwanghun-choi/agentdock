import { MIN_REPOSITORY_STARS } from '@/corpus/policy';
import { GitHubError } from '@/github/client';

export type IngestOutcome =
  | 'ok'
  | 'invalid_input'
  | 'denylisted'
  | 'unreadable'
  | 'rate_limited'
  | 'too_large'
  | 'no_artifacts'
  | 'unavailable'
  | 'storage_failed'
  // The three automatic-discovery gate outcomes (src/corpus/policy.ts). Named
  // separately rather than folded into one `not_eligible` because the scheduled
  // sync's summary reports a count per reason, and a single outcome would make
  // "36 forks" and "36 unpopular repositories" the same line.
  | 'forked'
  | 'archived'
  | 'below_star_floor';

/**
 * What an attempt row can record. Every ingestion outcome, plus the no-change
 * short circuit, which is a true answer about a repository rather than a
 * failure of one.
 */
export type AttemptOutcome = IngestOutcome | 'unchanged';

/**
 * The complete set of things a person can be told, and the only strings that
 * reach the interface. Nothing here interpolates an exception, a hostname, a
 * query, or a token — there is no code path along which one could.
 */
export const OUTCOME_MESSAGES: Record<Exclude<IngestOutcome, 'ok'>, string> = {
  invalid_input:
    'Enter a repository as owner/repo, for example anthropics/skills. ' +
    'AgentDock does not accept full URLs.',

  denylisted: 'This repository has been removed from AgentDock and will not be re-added.',

  // Both cases are named because they are genuinely indistinguishable: GitHub
  // returns a byte-identical response for a repository that does not exist and
  // one that is private, deliberately, so that a private repository's existence
  // is not leaked. Any sentence asserting non-existence is a false statement
  // about roughly half the repositories that produce this outcome.
  unreadable:
    'AgentDock could not read that repository. GitHub returns the same response ' +
    'for a repository that does not exist and one that is private, so AgentDock ' +
    'cannot tell which. Check the spelling; if it is private, AgentDock cannot index it.',

  rate_limited:
    'AgentDock has used its GitHub request budget for this hour. ' +
    'Without a token GitHub allows 60 requests an hour, and each repository costs two.',

  too_large:
    'That repository is larger than AgentDock will read in one pass. ' +
    'What was read has been stored, and the listing says it is incomplete.',

  no_artifacts:
    'AgentDock found no agent artifacts in that repository. ' +
    'It looks for skills, plugins, marketplaces, MCP servers, commands and hooks.',

  unavailable: 'AgentDock could not reach GitHub. Try again shortly.',

  storage_failed:
    'AgentDock read the repository but could not store the result. Nothing was saved.',

  // The three gate sentences below say what AgentDock's schedule does, never
  // what a repository is worth. Each names the rule and, where there is one, the
  // number — a reader who disagrees with the policy can then see the policy
  // rather than guess at it.
  forked:
    'AgentDock does not add forks through automatic discovery. ' +
    'The upstream repository is what it reads.',

  archived:
    'That repository is archived on GitHub, so automatic discovery does not add it. ' +
    'Anything AgentDock already read from it stays readable.',

  // Interpolated, never retyped: the floor has exactly one definition and a
  // sentence carrying a stale copy of it is worse than a sentence without one.
  below_star_floor:
    `AgentDock adds repositories with at least ${MIN_REPOSITORY_STARS} GitHub stars ` +
    'through automatic discovery. That is how it decides which unread repositories ' +
    'to spend a small request budget on first; it is not a statement about any artifact.',
};

/** Adds the reset time when it is known, because "try later" without a when is not actionable. */
export function messageFor(outcome: IngestOutcome, resetEpochSeconds?: number): string {
  if (outcome === 'ok') return '';
  const base = OUTCOME_MESSAGES[outcome];
  if (outcome !== 'rate_limited' || !resetEpochSeconds) return base;
  const at = new Date(resetEpochSeconds * 1000);
  return `${base} The budget resets at ${at.toISOString().slice(11, 16)} UTC.`;
}

/** Maps every internal failure onto exactly one outcome. Unknowns are storage failures, never leaks. */
export function toIngestOutcome(error: unknown): IngestOutcome {
  if (error instanceof GitHubError) {
    switch (error.failure) {
      case 'invalid_repo':
        return 'invalid_input';
      case 'unreadable':
        return 'unreadable';
      case 'rate_limited':
        return 'rate_limited';
      case 'too_large':
        return 'too_large';
      default:
        return 'unavailable';
    }
  }
  return 'storage_failed';
}
