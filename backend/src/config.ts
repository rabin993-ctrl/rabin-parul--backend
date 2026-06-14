import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://parul:parul@localhost:5432/parul"),
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(32)
    .default("development-only-secret-change-me-now"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  CORS_ORIGINS: z.string().default(""),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_PUBLIC_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("parul-media"),
  S3_ACCESS_KEY: z.string().default("parul"),
  S3_SECRET_KEY: z.string().min(8).default("parul-development-secret"),
  S3_PUBLIC_BASE_URL: z.string().url().default("http://localhost:9000/parul-media"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

if (
  config.NODE_ENV === "production" &&
  config.ACCESS_TOKEN_SECRET === "development-only-secret-change-me-now"
) {
  throw new Error("ACCESS_TOKEN_SECRET must be set in production");
}
