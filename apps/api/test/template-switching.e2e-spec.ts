import type { INestApplication } from '@nestjs/common';
import { TENANTS, assertSeeded, bootstrapTestApp, loginAdmin, onApi, onHost } from './helpers';

/**
 * TEMPLATE SWITCHING IS NON-DESTRUCTIVE
 * =====================================
 *
 * The product's central promise about storefront design: a shop owner can
 * change how their store *looks* without changing anything about what their
 * store *is*. Three hundred products, four thousand orders and every customer
 * account survive the switch untouched.
 *
 * That promise is architectural — switching writes three presentation columns
 * on one row and reads nothing else — but architecture drifts, so it is tested
 * against the real application and the real databases rather than asserted in
 * a comment.
 *
 * Each block below is one way the promise could break:
 *
 *   1. business data changing across a switch
 *   2. the switch leaking into another tenant's storefront
 *   3. preview writing something
 *   4. a round trip A → B → C → A losing the merchant's layout
 *
 * A failure here is a merchant losing their shop, not a cosmetic bug.
 */
describe('Template switching (e2e)', () => {
  let app: INestApplication;

  let kickzoneOwner: { token: string; tenantId: string | null };
  let kumarOwner: { token: string; tenantId: string | null };

  /** Everything about a store that a template must never touch. */
  interface BusinessSnapshot {
    products: { id: string; slug: string; priceFrom: number; inStock: boolean }[];
    categories: { id: string; slug: string }[];
    orderCount: number;
    orderNumbers: string[];
    customerIds: string[];
    inventory: { variantId: string; available: number }[];
    settings: Record<string, unknown>;
  }

  /**
   * Reads the store's business data through the same API a merchant uses.
   *
   * Deliberately reads through the API rather than the database: the point is
   * that nothing a *client* can observe has changed, which is a stronger claim
   * than "the rows look the same".
   */
  async function snapshot(
    host: string,
    owner: { token: string; tenantId: string | null },
  ): Promise<BusinessSnapshot> {
    const auth = (path: string) =>
      onApi(app)
        .get(path)
        .set('Authorization', `Bearer ${owner.token}`)
        .set('x-tenant-id', owner.tenantId ?? '');

    const [products, categories, orders, customers, inventory, settings] = await Promise.all([
      auth('/merchant/products?limit=100'),
      auth('/merchant/categories'),
      auth('/merchant/orders?limit=100'),
      auth('/merchant/customers?limit=100'),
      auth('/merchant/inventory?limit=100'),
      auth('/merchant/store'),
    ]);

    for (const res of [products, categories, orders, customers, inventory, settings]) {
      expect(res.status).toBe(200);
    }

    const items = <T>(body: { data: T[] | { items: T[] } }): T[] =>
      Array.isArray(body.data) ? body.data : body.data.items;

    const store = settings.body.data as Record<string, unknown>;
    // The presentation columns are the only ones allowed to move, so they are
    // excluded from the comparison rather than smuggled into it.
    const { template: _template, updatedAt: _updatedAt, ...businessSettings } = store;

    return {
      products: items<{ id: string; slug: string; priceFrom: number; inStock: boolean }>(
        products.body,
      )
        .map((p) => ({ id: p.id, slug: p.slug, priceFrom: p.priceFrom, inStock: p.inStock }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      categories: items<{ id: string; slug: string }>(categories.body)
        .map((c) => ({ id: c.id, slug: c.slug }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      orderCount: items<unknown>(orders.body).length,
      orderNumbers: items<{ orderNumber: string }>(orders.body)
        .map((o) => o.orderNumber)
        .sort(),
      customerIds: items<{ id: string }>(customers.body)
        .map((c) => c.id)
        .sort(),
      inventory: items<{ variantId: string; available: number }>(inventory.body)
        .map((i) => ({ variantId: i.variantId, available: i.available }))
        .sort((a, b) => a.variantId.localeCompare(b.variantId)),
      settings: withStableMedia(businessSettings),
    };
  }

  /**
   * Branding images in the store's own storage are served as presigned URLs,
   * re-signed on read so they never expire. The signature carries a timestamp,
   * so the same unchanged logo has a new query string after any cache refresh.
   * What must not change is *which object* it is — so compare without the
   * signature.
   */
  function withStableMedia(settings: Record<string, unknown>): Record<string, unknown> {
    const strip = (url: unknown) =>
      typeof url === 'string' && url.includes('X-Amz-Signature') ? url.split('?')[0] : url;
    return {
      ...settings,
      logoUrl: strip(settings.logoUrl),
      faviconUrl: strip(settings.faviconUrl),
      banners: ((settings.banners as { imageUrl?: string }[] | undefined) ?? []).map((b) => ({
        ...b,
        imageUrl: strip(b.imageUrl),
      })),
    };
  }

  const setTemplate = (owner: { token: string; tenantId: string | null }, templateId: string) =>
    onApi(app)
      .put('/merchant/store/template')
      .set('Authorization', `Bearer ${owner.token}`)
      .set('x-tenant-id', owner.tenantId ?? '')
      .send({ templateId });

  const activeTemplate = async (host: string): Promise<string> => {
    const res = await onHost(app, host).get('/store');
    expect(res.status).toBe(200);
    return res.body.data.store.template.templateId as string;
  };

  beforeAll(async () => {
    app = await bootstrapTestApp();
    await assertSeeded(app);

    [kickzoneOwner, kumarOwner] = await Promise.all([
      loginAdmin(app, TENANTS.kickzone.owner),
      loginAdmin(app, TENANTS.kumarstore.owner),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  // ─────────────────────────────────────────── 1. business data survives ──

  describe('business data is untouched by a switch', () => {
    it('leaves products, categories, orders, customers, inventory and settings identical', async () => {
      const before = await snapshot(TENANTS.kickzone.host, kickzoneOwner);
      const originalTemplate = await activeTemplate(TENANTS.kickzone.host);

      // Switch to a design from a completely different family, so any
      // data-shaping coupling between template and catalogue would show.
      const switched = await setTemplate(kickzoneOwner, 'spec-grid');
      expect(switched.status).toBe(200);
      expect(switched.body.data.template.templateId).toBe('spec-grid');

      const after = await snapshot(TENANTS.kickzone.host, kickzoneOwner);

      expect(after.products).toEqual(before.products);
      expect(after.categories).toEqual(before.categories);
      expect(after.orderCount).toBe(before.orderCount);
      expect(after.orderNumbers).toEqual(before.orderNumbers);
      expect(after.customerIds).toEqual(before.customerIds);
      expect(after.inventory).toEqual(before.inventory);
      expect(after.settings).toEqual(before.settings);

      // And the thing that was *supposed* to change, did.
      expect(await activeTemplate(TENANTS.kickzone.host)).toBe('spec-grid');

      await setTemplate(kickzoneOwner, originalTemplate);
    });

    it('does not renumber orders or reissue ids', async () => {
      const before = await snapshot(TENANTS.kickzone.host, kickzoneOwner);
      const original = await activeTemplate(TENANTS.kickzone.host);

      await setTemplate(kickzoneOwner, 'glow-beauty');
      await setTemplate(kickzoneOwner, 'pawsome');
      const after = await snapshot(TENANTS.kickzone.host, kickzoneOwner);

      expect(after.orderNumbers).toEqual(before.orderNumbers);
      expect(after.products.map((p) => p.id)).toEqual(before.products.map((p) => p.id));
      expect(after.customerIds).toEqual(before.customerIds);

      await setTemplate(kickzoneOwner, original);
    });
  });

  // ────────────────────────────────────────────────── 2. tenant isolation ──

  describe('a switch is tenant-scoped', () => {
    it('does not change another store’s storefront', async () => {
      const kumarBefore = await activeTemplate(TENANTS.kumarstore.host);
      const abcBefore = await activeTemplate(TENANTS.abcstore.host);
      const kickzoneOriginal = await activeTemplate(TENANTS.kickzone.host);

      await setTemplate(kickzoneOwner, 'silk-editorial');

      expect(await activeTemplate(TENANTS.kumarstore.host)).toBe(kumarBefore);
      expect(await activeTemplate(TENANTS.abcstore.host)).toBe(abcBefore);

      await setTemplate(kickzoneOwner, kickzoneOriginal);
    });

    it('refuses a merchant switching a store they do not belong to', async () => {
      const kickzoneBefore = await activeTemplate(TENANTS.kickzone.host);

      const res = await onApi(app)
        .put('/merchant/store/template')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        // Kumar's owner pointing the tenant hint at KickZone.
        .set('x-tenant-id', kickzoneOwner.tenantId ?? '')
        .send({ templateId: 'pawsome' });

      expect([401, 403, 404]).toContain(res.status);
      expect(await activeTemplate(TENANTS.kickzone.host)).toBe(kickzoneBefore);
    });
  });

  // ───────────────────────────────────────────────── 3. preview is inert ──

  describe('preview does not persist', () => {
    it('never changes the stored template', async () => {
      const before = await activeTemplate(TENANTS.kickzone.host);

      // The storefront honours `?__template=` for rendering. Whatever a client
      // asks the *API* for, the stored config must not move.
      const res = await onHost(app, TENANTS.kickzone.host).get('/store?__template=pawsome');
      expect(res.status).toBe(200);
      expect(res.body.data.store.template.templateId).toBe(before);
      expect(await activeTemplate(TENANTS.kickzone.host)).toBe(before);
    });
  });

  // ──────────────────────────────────── 4. round trip preserves the shop ──

  describe('A → B → C → A', () => {
    it('returns the store to exactly where it started', async () => {
      const original = await activeTemplate(TENANTS.kickzone.host);
      const before = await snapshot(TENANTS.kickzone.host, kickzoneOwner);

      for (const id of ['urban-luxe', 'spec-grid', 'daily-cart', original]) {
        const res = await setTemplate(kickzoneOwner, id);
        expect(res.status).toBe(200);
      }

      expect(await activeTemplate(TENANTS.kickzone.host)).toBe(original);
      expect(await snapshot(TENANTS.kickzone.host, kickzoneOwner)).toEqual(before);
    });

    it('remembers a merchant’s section layout across the round trip', async () => {
      const original = await activeTemplate(TENANTS.kickzone.host);

      const customise = (body: Record<string, unknown>) =>
        onApi(app)
          .put('/merchant/store/template')
          .set('Authorization', `Bearer ${kickzoneOwner.token}`)
          .set('x-tenant-id', kickzoneOwner.tenantId ?? '')
          .send(body);

      await customise({ templateId: 'urban-luxe' });
      const saved = await customise({ customization: { hiddenSections: ['testimonials'] } });
      expect(saved.status).toBe(200);
      expect(saved.body.data.template.customization.hiddenSections).toContain('testimonials');

      // Spec Grid has no `testimonials` section, so the stored preference is
      // simply not applied there — and must not be discarded either.
      await customise({ templateId: 'spec-grid' });
      const back = await customise({ templateId: 'urban-luxe' });
      expect(back.body.data.template.customization.hiddenSections).toContain('testimonials');

      await customise({ customization: { hiddenSections: [] } });
      await setTemplate(kickzoneOwner, original);
    });
  });

  // ───────────────────────────────────────────────── 5. invalid templates ──

  describe('unknown templates', () => {
    it('are rejected rather than stored', async () => {
      const before = await activeTemplate(TENANTS.kickzone.host);

      const res = await setTemplate(kickzoneOwner, 'not-a-real-template');
      expect(res.status).toBe(400);
      expect(await activeTemplate(TENANTS.kickzone.host)).toBe(before);
    });
  });
});
