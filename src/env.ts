import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

// Optional on purpose. AgentDock runs unauthenticated at 60 core requests an
// hour — two per repository, so about thirty repositories an hour — and must
// degrade to that rather than depend on a token existing. An empty or
// whitespace-only string is normalized to undefined so a placeholder left in
// .env behaves as "absent" rather than as a credential that fails on every call.
const githubToken = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/**
 * Reads the optional GitHub credential without validating the rest of the
 * environment.
 *
 * The full parse requires DATABASE_URL, and the HTTP client must work in a suite
 * that has no database at all — the SSRF and redirect regressions run under CI
 * with neither a database nor a network. Same schema, narrower blast radius.
 */
export function normalizeGithubToken(raw: string | undefined): string | undefined {
  return githubToken.parse(raw);
}

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  // The only two schemas AgentDock owns. Anything else is a boundary escape, so
  // it is rejected here rather than discovered when a statement lands elsewhere.
  DATABASE_SCHEMA: z.enum(['agentdock', 'agentdock_test']).default('agentdock'),
  GITHUB_TOKEN: githubToken,
  // INGEST_WORKER is gone, not defaulted. It switched an in-process poll loop
  // that `register()` started at web boot, which made every deploy and restart
  // an ingest trigger; the loop was deleted rather than defaulted off, because a
  // flag would have left the coupling one environment variable away from
  // returning. Ingestion is `bun run sync`, from cron.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process configuration and returns it typed.
 *
 * Failure messages name the variable and describe the problem. They never carry
 * the rejected value: these variables hold credentials, and an error string ends
 * up in terminals, log aggregators, and issue trackers. src/env.test.ts asserts
 * this with a sentinel.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(
    `Invalid environment configuration:\n${problems}\n\n` +
      'Every variable is documented in .env.example. If .env is missing, copy it from there.',
  );
}
