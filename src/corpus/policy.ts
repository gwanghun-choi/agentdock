/**
 * Which repositories automatic discovery reads, and the one number that decides
 * it.
 *
 * This is a SCHEDULING rule about work not yet done, and the distinction is the
 * whole reason it can coexist with 05-CONTEXT D-03, which refuses popularity as
 * a listing input. D-03 refuses to hide an artifact AgentDock has ALREADY READ
 * because its repository is unpopular. This gate decides which of the millions
 * of repositories nobody has looked at are worth two of sixty core requests an
 * hour — the same kind of decision the operator seed list makes by ordering on
 * artifact density.
 *
 * Two consequences follow, and both are enforced elsewhere rather than assumed:
 *
 * 1. **Nothing already stored is removed by this.** A repository whose stars
 *    later fall below the floor keeps every artifact it contributed. Entry is a
 *    gate; it is not a deletion rule. `refreshStaleRepositories` re-reads it on
 *    the ordinary schedule and `NOT_LISTED_BECAUSE` still says nothing about
 *    stars.
 * 2. **It is not a ranking input.** No listing, no search ordering and no
 *    suppression reason consults this module. `src/db/queries/search.ts` has no
 *    import of it, and must not gain one.
 */

/**
 * The floor, in GitHub stars.
 *
 * One constant rather than an environment variable, matching how CORPUS_CAPS
 * already carries every other acquisition bound. An operator who wants a
 * different corpus edits this line and rebuilds; an environment variable would
 * mean the same number lives in `src/env.ts`, `.env.example`, `.env.production`,
 * the Dockerfile's build args and two documents, for a value that changes about
 * as often as the schema does.
 *
 * ponytail: promote to a parsed environment variable the first time two
 * deployments genuinely need different floors.
 */
export const MIN_REPOSITORY_STARS = 50;

/** Why automatic discovery will not read a repository. Null means it will. */
export type DiscoveryRejection = 'forked' | 'archived' | 'below_star_floor';

/**
 * The complete gate, asked of the metadata AgentDock has already fetched.
 *
 * Public-ness is not tested here and cannot be: GitHub returns a byte-identical
 * 404 for a private repository and an absent one (src/github/repo.ts), so a
 * repository that reaches this function is public by construction — a private
 * one threw `unreadable` two calls earlier.
 *
 * Ordered structural-first. A fork and an archive are facts GitHub reports about
 * where a repository is; the star floor is AgentDock's own budget decision. A
 * caller that reports counts per reason gets the structural reasons attributed
 * to the structure rather than to the number, which is what the two mean.
 */
export function discoveryRejection(repo: {
  stars: number;
  isFork: boolean;
  isArchived: boolean;
}): DiscoveryRejection | null {
  if (repo.isFork) return 'forked';
  if (repo.isArchived) return 'archived';
  if (repo.stars < MIN_REPOSITORY_STARS) return 'below_star_floor';
  return null;
}
