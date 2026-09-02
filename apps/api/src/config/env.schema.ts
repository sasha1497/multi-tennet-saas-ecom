import { z } from 'zod';

/**
 * Environment contract for the API and the worker.
 *
 * The process refuses to boot on a bad environment. A misconfigured secret or a
 * missing database URL should fail loudly at startup, not silently at 3 a.m. on
 * the first request that happens to need it.
 */

const bool = (fallback: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(fallback)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (fallback: number) => z.coerce.number().int().default(fallback);

const csv = (fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : fallback,
    );

/** Dev placeholders that must never reach production. */
const DEV_PLACEHOLDERS = [
  'dev_access_secret_change_me_0123456789abcdef',
  'dev_refresh_secret_change_me_fedcba9876543210',
  'ZGV2LW9ubHktMzJieXRlLWtleS1kby1ub3QtdXNlISE=',
  'dev_cookie_secret_change_me',
  'dev_internal_api_key_change_me',
];

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    LOG_PRETTY: bool(false),

    // ------------------------------------------------------------ domains --
    PLATFORM_DOMAIN: z.string().min(1).default('localhost'),
    PLATFORM_PROTOCOL: z.enum(['http', 'https']).default('http'),
    ADMIN_SUBDOMAIN: z.string().default('admin'),
    API_SUBDOMAIN: z.string().default('api'),
    RESERVED_SUBDOMAINS: csv([]),

    API_PORT: int(4000),

    // ---------------------------------------------------------- master db --
    MASTER_DATABASE_URL: z.string().url({ message: 'MASTER_DATABASE_URL must be a valid URL' }),

    // ---------------------------------------------------------- tenant db --
    TENANT_DB_HOST: z.string().default('postgres'),
    TENANT_DB_PORT: int(5432),
    TENANT_DB_ADMIN_USER: z.string().min(1),
    TENANT_DB_ADMIN_PASSWORD: z.string().min(1),
    TENANT_DB_MAINTENANCE_DB: z.string().default('postgres'),
    TENANT_DB_NAME_PREFIX: z.string().default('tenant_'),
    TENANT_DB_USER_PREFIX: z.string().default('tu_'),
    TENANT_DB_CONNECTION_LIMIT: int(5),
    TENANT_POOL_MAX_CONNECTIONS: int(25),
    TENANT_POOL_IDLE_TIMEOUT_MS: int(300_000),
    TENANT_CLUSTER_ID: z.string().default('local-pg-1'),
    TENANT_DB_SSL: bool(false),
    /** Override for the tenant migrations directory (Docker layout differs). */
    TENANT_MIGRATIONS_DIR: z.string().optional(),

    // ------------------------------------------------------------ secrets --
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: int(900),
    JWT_REFRESH_TTL: int(2_592_000),
    JWT_ISSUER: z.string().default('retailos'),
    CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .min(1)
      .refine(
        (v) => Buffer.from(v, 'base64').length === 32,
        'CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)',
      ),
    COOKIE_SECRET: z.string().min(8).default('dev_cookie_secret_change_me'),
    INTERNAL_API_KEY: z.string().min(8).default('dev_internal_api_key_change_me'),

    // -------------------------------------------------------------- redis --
    REDIS_URL: z.string().default('redis://redis:6379'),
    REDIS_HOST: z.string().default('redis'),
    REDIS_PORT: int(6379),
    REDIS_PASSWORD: z.string().optional(),
    CACHE_TTL_DEFAULT: int(60),
    CACHE_TTL_TENANT_RESOLUTION: int(300),
    CACHE_TTL_CATALOG: int(120),

    // -------------------------------------------------------------- mysql --
    MYSQL_ENABLED: bool(false),
    MYSQL_URL: z.string().optional(),

    // ------------------------------------------------------------ storage --
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
    S3_ENDPOINT: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('retailos-media'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(true),
    STORAGE_LOCAL_DIR: z.string().default('./.storage'),
    UPLOAD_MAX_FILE_SIZE: int(5_242_880),
    UPLOAD_ALLOWED_MIME: csv(['image/jpeg', 'image/png', 'image/webp', 'image/avif']),

    // ----------------------------------------------------------- payments --
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    PAYMENT_CURRENCY: z.string().length(3).default('INR'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    MOCK_PAYMENT_WEBHOOK_SECRET: z.string().default('dev_mock_webhook_secret'),

    // ------------------------------------------------------ notifications --
    MAIL_DRIVER: z.enum(['smtp', 'log']).default('log'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: int(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool(false),
    MAIL_FROM: z.string().default('RetailOS <no-reply@localhost>'),
    SMS_DRIVER: z.enum(['log', 'msg91', 'twilio']).default('log'),
    SMS_API_KEY: z.string().optional(),
    SMS_SENDER_ID: z.string().default('RTLOS'),
    PUSH_DRIVER: z.enum(['log', 'fcm']).default('log'),
    FCM_PROJECT_ID: z.string().optional(),
    FCM_CLIENT_EMAIL: z.string().optional(),
    FCM_PRIVATE_KEY: z.string().optional(),

    // ----------------------------------------------------------- security --
    RATE_LIMIT_TTL: int(60),
    RATE_LIMIT_LIMIT: int(120),
    AUTH_RATE_LIMIT_LIMIT: int(10),
    SWAGGER_ENABLED: bool(true),

    // ------------------------------------------------------------- queues --
    QUEUE_PREFIX: z.string().default('retailos'),
    WORKER_CONCURRENCY: int(5),
    QUEUE_JOB_ATTEMPTS: int(5),
    QUEUE_JOB_BACKOFF_MS: int(5000),

    // ------------------------------------------------------ observability --
    OTEL_ENABLED: bool(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    SERVICE_NAME: z.string().default('retailos-api'),
    METRICS_ENABLED: bool(true),

    // --------------------------------------------------------------- seed --
    SEED_SUPER_ADMIN_EMAIL: z.string().email().default('admin@retailos.dev'),
    SEED_SUPER_ADMIN_PASSWORD: z.string().default('SuperAdmin@123'),
    SEED_DEFAULT_PASSWORD: z.string().default('Password@123'),
  })
  // Production must not run with the shipped development placeholders.
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const secrets: [string, string][] = [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['CREDENTIALS_ENCRYPTION_KEY', env.CREDENTIALS_ENCRYPTION_KEY],
      ['COOKIE_SECRET', env.COOKIE_SECRET],
      ['INTERNAL_API_KEY', env.INTERNAL_API_KEY],
    ];
    for (const [name, value] of secrets) {
      if (DEV_PLACEHOLDERS.includes(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} is still the development placeholder. Generate a real secret before deploying.`,
        });
      }
    }

    if (env.SWAGGER_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SWAGGER_ENABLED'],
        message: 'SWAGGER_ENABLED must be false in production.',
      });
    }

    if (env.PAYMENT_PROVIDER === 'razorpay' && !env.RAZORPAY_KEY_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RAZORPAY_KEY_SECRET'],
        message: 'RAZORPAY_KEY_SECRET is required when PAYMENT_PROVIDER=razorpay.',
      });
    }

    if (env.STORAGE_DRIVER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_DRIVER'],
        message:
          'STORAGE_DRIVER=local is not supported in production; use s3 so uploads survive a container restart.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Called by ConfigModule. Throws a readable aggregate error on bad config. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(
    `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
      `See .env.example and docs/DEVELOPMENT.md for the full variable list.`,
  );
}
