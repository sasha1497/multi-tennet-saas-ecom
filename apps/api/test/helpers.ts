import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { APP_PIPE } from '@nestjs/core';
import request from 'supertest';
import { API_PREFIX } from '@retailos/config';
import { AppModule } from '@/app.module';
import { installBigIntSerializer } from '@/common/utils/serialization';

installBigIntSerializer();

/**
 * Boots the real application against the real databases.
 *
 * These are integration tests on purpose. The behaviour under test — tenant
 * resolution, per-tenant database routing, guard ordering — lives in the
 * interaction between middleware, guards and Prisma. Mocking any of that would
 * test the mocks, not the isolation guarantee.
 */
export async function bootstrapTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix(API_PREFIX);
  await app.init();
  return app;
}

export const SEED_PASSWORD = 'Password@123';
export const SUPER_ADMIN = { email: 'admin@retailos.dev', password: 'SuperAdmin@123' };

export const TENANTS = {
  kickzone: {
    slug: 'kickzone',
    host: 'kickzone.localhost',
    owner: 'owner@kickzone.dev',
    staff: 'staff@kickzone.dev',
    customer: 'priya@example.com',
  },
  kumarstore: {
    slug: 'kumarstore',
    host: 'kumarstore.localhost',
    owner: 'owner@kumarstore.dev',
    staff: 'staff@kumarstore.dev',
    customer: 'karthik@example.com',
  },
  abcstore: {
    slug: 'abcstore',
    host: 'abcstore.localhost',
    owner: 'owner@abcstore.dev',
    staff: 'staff@abcstore.dev',
    customer: 'vikram@example.com',
  },
} as const;

type Server = Parameters<typeof request>[0];

export function http(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/** A request carrying a tenant hostname, exactly as nginx would forward it. */
export function onHost(app: INestApplication, host: string) {
  const agent = request(http(app));
  return {
    get: (path: string) => agent.get(`${API_PREFIX}${path}`).set('Host', host),
    post: (path: string) => agent.post(`${API_PREFIX}${path}`).set('Host', host),
    patch: (path: string) => agent.patch(`${API_PREFIX}${path}`).set('Host', host),
    delete: (path: string) => agent.delete(`${API_PREFIX}${path}`).set('Host', host),
  };
}

/** A request with no tenant hostname — the admin console / bare API domain. */
export function onApi(app: INestApplication) {
  return onHost(app, 'api.localhost');
}

export async function loginCustomer(
  app: INestApplication,
  host: string,
  identifier: string,
): Promise<string> {
  const res = await onHost(app, host)
    .post('/auth/customer/login')
    .send({ identifier, password: SEED_PASSWORD });

  if (res.status !== 200) {
    throw new Error(
      `Customer login failed for ${identifier} on ${host}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.data.tokens.accessToken as string;
}

export async function loginAdmin(
  app: INestApplication,
  email: string,
  password = SEED_PASSWORD,
): Promise<{ token: string; tenantId: string | null }> {
  const res = await onApi(app).post('/auth/login').send({ email, password });

  if (res.status !== 200) {
    throw new Error(
      `Admin login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return {
    token: res.body.data.tokens.accessToken as string,
    tenantId: res.body.data.session.activeTenantId as string | null,
  };
}

/**
 * Confirms the seed has been run. Without it every assertion below would fail
 * for an uninteresting reason, so we fail fast with an actionable message.
 */
export async function assertSeeded(app: INestApplication): Promise<void> {
  const res = await onHost(app, TENANTS.kickzone.host).get('/store');
  if (res.status !== 200) {
    throw new Error(
      'Seed data is missing. Run `pnpm docker:up:infra && pnpm db:migrate:deploy && pnpm db:seed` before the e2e suite.',
    );
  }
}
