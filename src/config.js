import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  GITLAB_HOST: z.string().url(),
  GITLAB_TOKEN: z.string().min(1),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),
  GITLAB_BOT_USERNAME: z.string().min(1),

  AI_BASE_URL: z.string().url(),
  AI_API_KEY: z.string().min(1),
  AI_MODEL: z.string().min(1),

  REVIEW_GUIDE_PATH: z.string().default('docs/REVIEW_GUIDE.md'),
  MAX_DIFF_BYTES: z.coerce.number().default(200_000),
  DB_PATH: z.string().default('./data/state.db'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
