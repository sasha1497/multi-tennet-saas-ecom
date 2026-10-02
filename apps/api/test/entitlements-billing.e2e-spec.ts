import type { INestApplication } from '@nestjs/common';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { CacheService } from '@/core/cache/cache.service';
import { StorageService } from '@/core/storage/storage.service';
import { cacheKeys } from '@retailos/config';
import { SUPER_ADMIN, TENANTS, assertSeeded, bootstrapTestApp, loginAdmin, onApi, onHost } from './helpers';

/**
 * PLANS DECIDE WHAT A STORE MAY CHOOSE — NEVER WHAT IT KEEPS
 * ==========================================================
 *
 * Template families, billing and AI metering, tested against the real app and
 * the real databases. The seeded stores sit on one plan each:
 *
 *   abcstore   STARTER  standard templates only, 10 AI generations
 *   kumarstore GROWTH   + premium templates
 *   kickzone   PRO      + 3D templates
 *
 * What must hold:
 *   1. the server refuses a template family the plan does not include
 *   2. a whole family unlocks at once
 *   3. a downgrade locks *choosing*, but keeps the live template and every
 *      product, order and customer exactly as they were
 *   4. an unpublished template cannot be newly adopted
 *   5. billing: paid moves the plan, failed leaves it (grace), replay is a no-op,
 *      one store cannot settle another's checkout
 *   6. AI: plan-gated, metered, cached, and never past the monthly allowance
 *
 * Every test restores what it changes; the seed's plans and templates are the
 * fixture for the rest of the suite.
 */
describe('Entitlements, billing and AI metering (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;
  let cache: CacheService;

  type Owner = { token: string; tenantId: string | null };
  let starter: Owner;
  let growth: Owner;
  let pro: Owner;
  let admin: { token: string };

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  const as = (owner: Owner) => ({
    get: (path: string) =>
      onApi(app).get(path).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId ?? ''),
    post: (path: string) =>
      onApi(app).post(path).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId ?? ''),
    put: (path: string) =>
      onApi(app).put(path).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId ?? ''),
  });
  const asAdmin = () => ({
    get: (path: string) => onApi(app).get(path).set('Authorization', `Bearer ${admin.token}`),
    post: (path: string) => onApi(app).post(path).set('Authorization', `Bearer ${admin.token}`),
    patch: (path: string) => onApi(app).patch(path).set('Authorization', `Bearer ${admin.token}`),
  });

  const activeTemplate = async (host: string): Promise<string> => {
    const res = await onHost(app, host).get('/store');
    expect(res.status).toBe(200);
    return res.body.data.store.template.templateId as string;
  };
  const setTemplate = (owner: Owner, templateId: string) =>
    as(owner).put('/merchant/store/template').send({ templateId });
  const moveToPlan = async (owner: Owner, planCode: string) => {
    const res = await asAdmin().post(`/platform/tenants/${owner.tenantId}/subscription`).send({ planCode });
    expect(res.status).toBe(200);
  };

  const originals: Record<string, string> = {};

  beforeAll(async () => {
    app = await bootstrapTestApp();
    await assertSeeded(app);
    master = app.get(MasterPrismaService);
    cache = app.get(CacheService);

    starter = await loginAdmin(app, TENANTS.abcstore.owner);
    growth = await loginAdmin(app, TENANTS.kumarstore.owner);
    pro = await loginAdmin(app, TENANTS.kickzone.owner);
    admin = await loginAdmin(app, SUPER_ADMIN.email, SUPER_ADMIN.password);

    for (const t of Object.values(TENANTS)) originals[t.host] = await activeTemplate(t.host);

    // Start from the seeded plans, whatever an earlier aborted run left behind.
    await moveToPlan(starter, 'STARTER');
    await moveToPlan(growth, 'GROWTH');
    await moveToPlan(pro, 'PRO');
  }, 120_000);

  afterAll(async () => {
    if (master) {
      await moveToPlan(starter, 'STARTER');
      await moveToPlan(growth, 'GROWTH');
      await moveToPlan(pro, 'PRO');
      await setTemplate(starter, originals[TENANTS.abcstore.host]!);
      await setTemplate(growth, originals[TENANTS.kumarstore.host]!);
      await setTemplate(pro, originals[TENANTS.kickzone.host]!);
      await master.templatePublication.deleteMany({});
      await cache.del(cacheKeys.templatePublications());
    }
    await app?.close();
  });

  // ────────────────────────────────────────────── 1–2. family entitlement ──

  describe('template families', () => {
    it('shows every family, and locks the ones the plan does not include', async () => {
      const res = await as(starter).get('/merchant/templates');
      expect(res.status).toBe(200);
      const { templates, access } = res.body.data as {
        templates: { id: string; tier: string }[];
        access: Record<string, { allowed: boolean; requiredPlan: string }>;
      };

      const tiers = new Set(templates.map((t) => t.tier));
      expect(tiers).toEqual(new Set(['standard', 'premium', '3d']));
      for (const t of templates) {
        expect(access[t.id]!.allowed).toBe(t.tier === 'standard');
      }
      expect(access['nova']!.requiredPlan).toBe('GROWTH');
      expect(access['orbit']!.requiredPlan).toBe('PRO');
    });

    it('refuses a premium template on Starter, server-side, and changes nothing', async () => {
      const before = await activeTemplate(TENANTS.abcstore.host);
      const res = await setTemplate(starter, 'nova');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FEATURE_NOT_ENTITLED');
      expect(res.body.error.details.featureKey).toBe('templates_premium');
      expect(await activeTemplate(TENANTS.abcstore.host)).toBe(before);
    });

    it('lets Starter move freely between standard templates', async () => {
      for (const id of ['urban-luxe', 'spec-grid', 'daily-cart']) {
        expect((await setTemplate(starter, id)).status).toBe(200);
        expect(await activeTemplate(TENANTS.abcstore.host)).toBe(id);
      }
    });

    it('unlocks every premium template on Growth, but not 3D', async () => {
      for (const id of ['nova', 'lookbook', 'maison']) {
        expect((await setTemplate(growth, id)).status).toBe(200);
      }
      const res = await setTemplate(growth, 'prism');
      expect(res.status).toBe(403);
      expect(res.body.error.details.featureKey).toBe('templates_3d');
    });

    it('unlocks the 3D family on Pro', async () => {
      for (const id of ['orbit', 'prism', 'atelier-noir', 'pawsome']) {
        expect((await setTemplate(pro, id)).status).toBe(200);
        expect(await activeTemplate(TENANTS.kickzone.host)).toBe(id);
      }
    });
  });

  // ───────────────────────────────────────────────────────── 3. downgrade ──

  describe('downgrade', () => {
    it('keeps the live 3D template and all business data, and only locks choosing', async () => {
      expect((await setTemplate(pro, 'orbit')).status).toBe(200);
      const productsBefore = await as(pro).get('/merchant/products?limit=100');
      const ordersBefore = await as(pro).get('/merchant/orders?limit=100');

      await moveToPlan(pro, 'GROWTH');

      // The storefront still renders what the merchant chose.
      expect(await activeTemplate(TENANTS.kickzone.host)).toBe('orbit');

      const gallery = await as(pro).get('/merchant/templates');
      expect(gallery.body.data.activeAllowed).toBe(false);
      expect(gallery.body.data.access['orbit'].allowed).toBe(false);

      // Editing the current layout still works — nothing is frozen or reset.
      const edit = await as(pro)
        .put('/merchant/store/template')
        .send({ customization: { hiddenSections: ['offers'] } });
      expect(edit.status).toBe(200);
      expect(edit.body.data.template.templateId).toBe('orbit');

      // Moving to an allowed family works; coming back to 3D does not.
      expect((await setTemplate(pro, 'nova')).status).toBe(200);
      expect((await setTemplate(pro, 'orbit')).status).toBe(403);

      const productsAfter = await as(pro).get('/merchant/products?limit=100');
      const ordersAfter = await as(pro).get('/merchant/orders?limit=100');
      expect(productsAfter.body.data).toEqual(productsBefore.body.data);
      expect(ordersAfter.body.data).toEqual(ordersBefore.body.data);

      // Upgrading again restores the family at once.
      await moveToPlan(pro, 'PRO');
      expect((await setTemplate(pro, 'orbit')).status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────── 4. publish state ──

  describe('publish state', () => {
    it('stops new adoptions of an unpublished template without touching stores on it', async () => {
      expect((await setTemplate(growth, 'lookbook')).status).toBe(200);

      const off = await asAdmin().patch('/platform/templates/lookbook').send({ isPublished: false });
      expect(off.status).toBe(200);

      // Kumar is on it and keeps it; it stays visible in Kumar's gallery.
      expect(await activeTemplate(TENANTS.kumarstore.host)).toBe('lookbook');
      const kumarGallery = await as(growth).get('/merchant/templates');
      expect(kumarGallery.body.data.templates.some((t: { id: string }) => t.id === 'lookbook')).toBe(true);

      // KickZone (Pro, entitled) cannot newly adopt it, and does not see it.
      expect((await setTemplate(pro, 'lookbook')).status).toBe(400);
      const kzGallery = await as(pro).get('/merchant/templates');
      expect(kzGallery.body.data.templates.some((t: { id: string }) => t.id === 'lookbook')).toBe(false);

      const on = await asAdmin().patch('/platform/templates/lookbook').send({ isPublished: true });
      expect(on.status).toBe(200);
      expect((await setTemplate(pro, 'lookbook')).status).toBe(200);
    });

    it('is a super-admin operation', async () => {
      const res = await onApi(app)
        .patch('/platform/templates/nova')
        .set('Authorization', `Bearer ${pro.token}`)
        .send({ isPublished: false });
      expect([401, 403]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────── 5. billing ──

  describe('billing', () => {
    const checkout = async (owner: Owner, planCode: string) => {
      const res = await as(owner).post('/merchant/subscription/checkout').send({ planCode });
      expect(res.status).toBe(200);
      return res.body.data as { reference: string; amount: number };
    };

    it('charges the plan price set on the plan row, not anything the client sends', async () => {
      const plans = await asAdmin().get('/platform/plans');
      const proPlan = (plans.body.data as { code: string; priceMonthly: number }[]).find(
        (p) => p.code === 'PRO',
      )!;
      const started = await checkout(growth, 'PRO');
      expect(started.amount).toBe(proPlan.priceMonthly);
    });

    it('upgrades on payment, records an invoice, and unlocks the family at once', async () => {
      const { reference } = await checkout(growth, 'PRO');
      const paid = await as(growth)
        .post('/merchant/subscription/confirm')
        .send({ planCode: 'PRO', reference });
      expect(paid.status).toBe(200);
      expect(paid.body.data.planCode).toBe('PRO');

      expect((await setTemplate(growth, 'prism')).status).toBe(200);

      const overview = await as(growth).get('/merchant/subscription');
      expect(overview.body.data.subscription.planCode).toBe('PRO');
      expect(overview.body.data.templates.families).toEqual(['standard', 'premium', '3d']);
      expect(
        overview.body.data.invoices.some(
          (i: { reference: string; status: string }) => i.reference === reference && i.status === 'PAID',
        ),
      ).toBe(true);

      // A replayed confirmation is a no-op, not a second month.
      const again = await as(growth)
        .post('/merchant/subscription/confirm')
        .send({ planCode: 'PRO', reference });
      expect(again.status).toBe(200);
      expect(again.body.data.currentPeriodEnd).toBe(paid.body.data.currentPeriodEnd);
    });

    it('keeps the plan through a failed renewal (grace), and marks it past due', async () => {
      const { reference } = await checkout(growth, 'PRO');
      const failed = await as(growth)
        .post('/merchant/subscription/confirm')
        .send({ planCode: 'PRO', reference, outcome: 'failed' });
      expect(failed.status).toBe(200);
      expect(failed.body.data.invoiceStatus).toBe('FAILED');

      const overview = await as(growth).get('/merchant/subscription');
      expect(overview.body.data.subscription.status).toBe('PAST_DUE');
      expect(overview.body.data.subscription.lapsed).toBe(false);
      expect(overview.body.data.subscription.graceEndsAt).toBeTruthy();
      expect(overview.body.data.effective.features.templates_3d).toBe(true);
    });

    it('refuses to sell a non-public plan', async () => {
      for (const code of ['FREE', 'ENTERPRISE']) {
        const res = await as(growth).post('/merchant/subscription/checkout').send({ planCode: code });
        expect(res.status).toBe(404);
      }
    });

    it('refuses to settle another store’s checkout', async () => {
      const { reference } = await checkout(growth, 'PRO');
      const res = await as(starter)
        .post('/merchant/subscription/confirm')
        .send({ planCode: 'PRO', reference });
      expect(res.status).toBe(400);

      const starterOverview = await as(starter).get('/merchant/subscription');
      expect(starterOverview.body.data.subscription.planCode).toBe('STARTER');
    });

    it('reports fleet billing to the platform', async () => {
      const res = await asAdmin().get('/platform/billing/overview');
      expect(res.status).toBe(200);
      expect(res.body.data.mrr).toBeGreaterThan(0);
      // Kumar was upgraded above, so at this moment the stores sit on Starter and Pro.
      const byPlan = res.body.data.byPlan as { code: string; stores: number; mrr: number }[];
      expect(byPlan.map((p) => p.code)).toEqual(expect.arrayContaining(['STARTER', 'PRO']));
      expect(byPlan.reduce((sum, p) => sum + p.mrr, 0)).toBe(res.body.data.mrr);
      expect(res.body.data.last30Days.failed.count).toBeGreaterThan(0);
    });

    afterAll(async () => {
      await moveToPlan(growth, 'GROWTH');
    });
  });

  // ───────────────────────────────────────────────────────────────── 6. AI ──

  describe('AI product suggestions', () => {
    let objectKey: string;
    let starterTenantId: string;

    beforeAll(async () => {
      starterTenantId = starter.tenantId!;
      await master.aiGeneration.deleteMany({ where: { tenantId: starterTenantId } });
      const stored = await app.get(StorageService).upload({
        buffer: PNG,
        originalName: 'ai-test.png',
        mimeType: 'image/png',
        tenantId: starterTenantId,
        folder: 'products',
      });
      objectKey = stored.key;
    });

    afterAll(async () => {
      await master.aiGeneration.deleteMany({ where: { tenantId: starterTenantId } });
      await master.featureEntitlement.deleteMany({
        where: { tenantId: starterTenantId, source: 'OVERRIDE', featureKey: 'ai_generations_per_month' },
      });
      await cache.del(cacheKeys.entitlements(starterTenantId));
    });

    const suggest = (hint?: string) =>
      as(starter).post('/merchant/ai/product-suggestions').send({ objectKey, hint });

    it('drafts a listing and counts one generation', async () => {
      const res = await suggest('cotton tote');
      expect(res.status).toBe(200);
      expect(res.body.data.cached).toBe(false);
      expect(res.body.data.suggestion.name).toBeTruthy();
      expect(res.body.data.usage).toMatchObject({ used: 1, limit: 10 });
    });

    it('serves an identical request from the cache, free', async () => {
      const res = await suggest('cotton tote');
      expect(res.status).toBe(200);
      expect(res.body.data.cached).toBe(true);
      expect(res.body.data.usage.used).toBe(1);
    });

    it('stops at the monthly allowance', async () => {
      await asAdmin()
        .post(`/platform/tenants/${starterTenantId}/entitlements`)
        .send({ featureKey: 'ai_generations_per_month', enabled: true, limitValue: 1 });

      const res = await suggest('a different note');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');

      // A refused request is not charged.
      const usage = await as(starter).get('/merchant/ai/usage');
      expect(usage.body.data.used).toBe(1);
    });

    it('cannot describe another store’s photograph', async () => {
      const res = await as(pro).post('/merchant/ai/product-suggestions').send({ objectKey });
      expect([400, 403, 404]).toContain(res.status);
    });
  });
});
