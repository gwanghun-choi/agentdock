import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
    message: 'must be a postgres:// or postgresql:// connection string',
  });

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  // The only two schemas AgentDock owns. Anything else is a boundary escape, so
  // it is rejected here rather than discovered when a statement lands elsewhere.
  DATABASE_SCHEMA: z.enum(['agentdock', 'agentdock_test']).default('agentdock'),
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
