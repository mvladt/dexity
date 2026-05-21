import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  ACCESS_TOKEN: z.string().min(1),
  YC_FOLDER_ID: z.string().min(1),
  YC_API_KEY: z.string().min(1),
  MODEL_ID: z.string().min(1),
  DATABASE_PATH: z.string().min(1),
  CORS_ORIGIN: isProd ? z.string().url().optional() : z.string().url(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
