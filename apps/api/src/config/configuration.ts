import { DEFAULT_RESERVED_SUBDOMAINS } from '@retailos/config';
import type { Env } from './env.schema';

/**
 * Turns the flat, validated environment into a nested, typed configuration
 * object. Services inject `AppConfigService` and read `cfg.tenantDb.host`
 * rather than reaching for `process.env` — which keeps configuration testable
 * and makes every consumer visible.
 */
export function buildConfig(env: Env) {
  const isProd = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  return {
    env: env.NODE_ENV,
    isProd,
    isTest,
    isDev: env.NODE_ENV === 'development',
    serviceName: env.SERVICE_NAME,

    http: {
      port: env.API_PORT,
    },

    log: {
      level: env.LOG_LEVEL,
      pretty: env.LOG_PRETTY,
    },

    domain: {
      platformDomain: env.PLATFORM_DOMAIN,
      protocol: env.PLATFORM_PROTOCOL,
      adminSubdomain: env.ADMIN_SUBDOMAIN,
      apiSubdomain: env.API_SUBDOMAIN,
      reservedSubdomains: [
        ...new Set([...DEFAULT_RESERVED_SUBDOMAINS, ...env.RESERVED_SUBDOMAINS]),
      ],
    },

    masterDb: {
      url: env.MASTER_DATABASE_URL,
    },

    tenantDb: {
      host: env.TENANT_DB_HOST,
      port: env.TENANT_DB_PORT,
      adminUser: env.TENANT_DB_ADMIN_USER,
      adminPassword: env.TENANT_DB_ADMIN_PASSWORD,
      maintenanceDb: env.TENANT_DB_MAINTENANCE_DB,
      namePrefix: env.TENANT_DB_NAME_PREFIX,
      userPrefix: env.TENANT_DB_USER_PREFIX,
      connectionLimit: env.TENANT_DB_CONNECTION_LIMIT,
      poolMaxConnections: env.TENANT_POOL_MAX_CONNECTIONS,
      poolIdleTimeoutMs: env.TENANT_POOL_IDLE_TIMEOUT_MS,
      clusterId: env.TENANT_CLUSTER_ID,
      ssl: env.TENANT_DB_SSL,
      migrationsDir: env.TENANT_MIGRATIONS_DIR,
    },

    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      issuer: env.JWT_ISSUER,
      /** Progressive lockout after this many consecutive failures. */
      maxFailedLogins: 8,
      lockoutMinutes: 15,
    },

    crypto: {
      credentialsKey: Buffer.from(env.CREDENTIALS_ENCRYPTION_KEY, 'base64'),
      cookieSecret: env.COOKIE_SECRET,
      internalApiKey: env.INTERNAL_API_KEY,
    },

    redis: {
      url: env.REDIS_URL,
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      ttl: {
        default: env.CACHE_TTL_DEFAULT,
        tenantResolution: env.CACHE_TTL_TENANT_RESOLUTION,
        catalog: env.CACHE_TTL_CATALOG,
      },
    },

    mysql: {
      enabled: env.MYSQL_ENABLED,
      url: env.MYSQL_URL,
    },

    storage: {
      driver: env.STORAGE_DRIVER,
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      localDir: env.STORAGE_LOCAL_DIR,
      maxFileSize: env.UPLOAD_MAX_FILE_SIZE,
      allowedMime: env.UPLOAD_ALLOWED_MIME,
    },

    payments: {
      provider: env.PAYMENT_PROVIDER,
      currency: env.PAYMENT_CURRENCY,
      razorpay: {
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_KEY_SECRET,
        webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
      },
      mock: {
        webhookSecret: env.MOCK_PAYMENT_WEBHOOK_SECRET,
      },
    },

    notifications: {
      mail: {
        driver: env.MAIL_DRIVER,
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
        secure: env.SMTP_SECURE,
        from: env.MAIL_FROM,
      },
      sms: {
        driver: env.SMS_DRIVER,
        apiKey: env.SMS_API_KEY,
        senderId: env.SMS_SENDER_ID,
      },
      push: {
        driver: env.PUSH_DRIVER,
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY,
      },
    },

    security: {
      rateLimitTtl: env.RATE_LIMIT_TTL,
      rateLimitLimit: env.RATE_LIMIT_LIMIT,
      authRateLimit: env.AUTH_RATE_LIMIT_LIMIT,
      swaggerEnabled: env.SWAGGER_ENABLED && !isProd,
    },

    queue: {
      prefix: env.QUEUE_PREFIX,
      concurrency: env.WORKER_CONCURRENCY,
      attempts: env.QUEUE_JOB_ATTEMPTS,
      backoffMs: env.QUEUE_JOB_BACKOFF_MS,
    },

    observability: {
      otelEnabled: env.OTEL_ENABLED,
      otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      metricsEnabled: env.METRICS_ENABLED,
    },

    seed: {
      superAdminEmail: env.SEED_SUPER_ADMIN_EMAIL,
      superAdminPassword: env.SEED_SUPER_ADMIN_PASSWORD,
      defaultPassword: env.SEED_DEFAULT_PASSWORD,
    },
  };
}

export type AppConfig = ReturnType<typeof buildConfig>;
