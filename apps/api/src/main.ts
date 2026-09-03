import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestJsSwagger } from 'nestjs-zod';
import compression from 'compression';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { API_PREFIX, HEADERS, normaliseHostname } from '@retailos/config';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.module';
import { AppLogger } from './core/logger/logger.service';
import { installBigIntSerializer } from './common/utils/serialization';

// Prisma returns BigInt for lifetime aggregates; JSON.stringify throws on those.
installBigIntSerializer();

// Teaches @nestjs/swagger to read Zod schemas, so the OpenAPI document is
// generated from the same definitions the API validates against.
patchNestJsSwagger();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Payment webhooks are signed over the exact bytes received, so the raw
    // body must survive JSON parsing.
    rawBody: true,
  });

  const config = app.get(AppConfigService);
  const logger = app.get(AppLogger).withContext('Bootstrap');
  app.useLogger(logger);

  // Behind nginx/ALB: makes req.ip the real client address for rate limiting.
  // Reached through the adapter so main.ts does not have to import the Express
  // application type just for one setting.
  (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
    'trust proxy',
    1,
  );

  app.setGlobalPrefix(API_PREFIX);

  app.use(
    helmet({
      // The API serves JSON, never HTML, so CSP here would only affect Swagger.
      contentSecurityPolicy: config.isProd ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: config.isProd ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(compression());

  /**
   * CORS.
   *
   * Allows the platform domain and **any** of its subdomains, because every
   * tenant storefront lives on one. A static allow-list is impossible here — the
   * set of origins grows every time a merchant signs up — so the check is a
   * suffix match against the configured platform domain and nothing else.
   */
  const platformDomain = normaliseHostname(config.domain.platformDomain);
  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin, curl, mobile apps and server-side calls send no Origin.
      if (!origin) return callback(null, true);
      try {
        const host = normaliseHostname(new URL(origin).hostname);
        const allowed = host === platformDomain || host.endsWith(`.${platformDomain}`);
        if (allowed) return callback(null, true);
        // Local device testing against a LAN IP.
        if (!config.isProd && /^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return callback(null, true);
        return callback(null, false);
      } catch {
        return callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      HEADERS.TENANT_ID,
      HEADERS.TENANT_SLUG,
      HEADERS.GUEST_TOKEN,
      HEADERS.REQUEST_ID,
      HEADERS.IDEMPOTENCY_KEY,
    ],
    exposedHeaders: [HEADERS.GUEST_TOKEN, HEADERS.REQUEST_ID, 'X-RateLimit-Remaining'],
    maxAge: 86_400,
  });

  // Bound the request body: nothing legitimate here needs megabytes of JSON.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const length = Number(req.headers['content-length'] ?? 0);
    if (length > 2 * 1024 * 1024 && !req.path.includes('/files/upload')) {
      res.status(413).json({
        success: false,
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
        requestId: req.header(HEADERS.REQUEST_ID) ?? 'unknown',
      });
      return;
    }
    next();
  });

  if (config.security.swaggerEnabled) {
    const documentConfig = new DocumentBuilder()
      .setTitle('RetailOS API')
      .setDescription(
        [
          'Multi-tenant retail commerce API.',
          '',
          '**Tenant resolution.** Storefront routes resolve the tenant from the request `Host`',
          '(`kickzone.ourdomain.in`). Merchant console routes resolve it from the authenticated',
          "user's verified membership. A tenant id is never accepted from a request body or query",
          'string.',
          '',
          '**Money.** All amounts are integers in the minor unit (paise for INR).',
          '',
          '**Responses.** Every success is `{ success, data, meta?, requestId }`; every failure is',
          '`{ success: false, error: { code, message, details }, requestId }`.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .addGlobalParameters({
        name: HEADERS.TENANT_ID,
        in: 'header',
        required: false,
        description:
          'Merchant console only: selects which of your stores to act on. Verified against your ' +
          'membership — it cannot grant access you do not already have.',
        schema: { type: 'string', format: 'uuid' },
      })
      .addTag('Authentication')
      .addTag('Storefront')
      .addTag('Cart')
      .addTag('Orders (customer)')
      .addTag('Customer account')
      .addTag('Payments')
      .addTag('Merchant')
      .addTag('Platform (super admin)')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('docs', app, document, {
      customSiteTitle: 'RetailOS API',
      swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' },
    });

    logger.info(`API documentation available at /docs`);
  }

  // Lets Kubernetes/Docker stop the process cleanly: pools drain, in-flight
  // requests finish, tenant connections close.
  app.enableShutdownHooks();

  await app.listen(config.http.port, '0.0.0.0');

  logger.info('API started', {
    port: config.http.port,
    env: config.env,
    prefix: API_PREFIX,
    platformDomain,
    paymentProvider: config.payments.provider,
    storageDriver: config.storage.driver,
  });
}

bootstrap().catch((err) => {
  // The logger may not exist yet if config validation failed, so this is a
  // deliberate console write.

  console.error('Failed to start the API:', err);
  process.exit(1);
});
