import { resolve } from 'node:path';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'sim'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().positive());

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: int(3333),
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: bool(false),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  DATABASE_SSL: bool(false),
  AUTO_MIGRATE: bool(true),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET deve ter no mínimo 32 caracteres'),
  ACCESS_TOKEN_TTL_MINUTES: int(15),
  REFRESH_TOKEN_TTL_DAYS: int(7),
  COOKIE_SECURE: bool(true),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional().transform((v) => v || undefined),
  LOGIN_MAX_ATTEMPTS: int(5),
  LOGIN_LOCK_MINUTES: int(15),
  LOGIN_RATE_LIMIT_PER_MINUTE: int(10),
  AGENT_API_TOKEN: z.string().min(24, 'AGENT_API_TOKEN deve ter no mínimo 24 caracteres'),
  AGENT_OFFLINE_AFTER_SECONDS: int(60),
  AGENT_RUN_STALE_SECONDS: int(300),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default(''),
  DP_APPROVAL_EMAIL: z.string().optional().default(''),
  LOGO_PATH: z.string().optional().default(''),
  MAX_XML_FILE_MB: int(20),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  const e = parsed.data;
  if (e.COOKIE_SAMESITE === 'none' && !e.COOKIE_SECURE) {
    throw new Error('COOKIE_SAMESITE=none exige COOKIE_SECURE=true');
  }
  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    host: e.HOST,
    port: e.PORT,
    appPublicUrl: e.APP_PUBLIC_URL.replace(/\/$/, ''),
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    autoMigrate: e.AUTO_MIGRATE,
    jwtSecret: e.JWT_ACCESS_SECRET,
    accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_MINUTES * 60,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    cookie: { secure: e.COOKIE_SECURE, sameSite: e.COOKIE_SAMESITE, domain: e.COOKIE_DOMAIN },
    login: { maxAttempts: e.LOGIN_MAX_ATTEMPTS, lockMinutes: e.LOGIN_LOCK_MINUTES, ratePerMinute: e.LOGIN_RATE_LIMIT_PER_MINUTE },
    agent: {
      token: e.AGENT_API_TOKEN,
      offlineAfterSeconds: e.AGENT_OFFLINE_AFTER_SECONDS,
      runStaleSeconds: e.AGENT_RUN_STALE_SECONDS,
    },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.SMTP_FROM,
    },
    approvalEmail: e.DP_APPROVAL_EMAIL,
    logoPath: e.LOGO_PATH ? resolve(e.LOGO_PATH) : '',
    maxXmlFileBytes: e.MAX_XML_FILE_MB * 1024 * 1024,
  };
}
