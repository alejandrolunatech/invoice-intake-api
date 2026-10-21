import { z } from 'zod';

/** All settings come from the environment and are checked once at start-up. */
const environment = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().optional(),
  EXTRACTOR: z.enum(['scripted', 'openai']).default('scripted'),
  LLM_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
  LLM_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().default('anthropic/claude-haiku-5.5'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).refine((env) => env.EXTRACTOR !== 'openai' || Boolean(env.LLM_API_KEY), {
  message: 'EXTRACTOR=openai needs LLM_API_KEY', path: ['LLM_API_KEY'],
});

export type Config = z.infer<typeof environment>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return environment.parse(env);
}
