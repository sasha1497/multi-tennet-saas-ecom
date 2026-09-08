import { Injectable } from '@nestjs/common';
import { cacheKeys, defaultStoreTheme } from '@retailos/config';
import {
  defaultTemplateFor,
  getTemplate,
  listTemplates,
  recommendedTemplates,
  sanitiseCustomization,
  type TemplateDefinition,
} from '@retailos/templates';
import { AuditAction, type StoreSettings, type StorefrontBootstrap } from '@retailos/types';
import type { UpdateStoreSettingsInput, UpdateStoreTemplateInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { RequestContextService } from '@/core/context/request-context';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AuditService } from '@/modules/audit/audit.service';
import { CategoriesService } from '@/modules/catalog/categories.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import type { PricingStoreConfig } from '@/modules/cart/pricing.service';

@Injectable()
export class StoreService {
  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly cache: CacheService,
    private readonly context: RequestContextService,
    private readonly categories: CategoriesService,
    private readonly entitlements: EntitlementsService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The storefront's first call: branding, settings and navigation in one
   * round trip, so the shell can render without a waterfall of requests.
   */
  async bootstrap(): Promise<StorefrontBootstrap> {
    const tenant = this.context.requireTenant();
    const [store, categories, entitlements] = await Promise.all([
      this.getSettings(),
      this.categories.tree(),
      this.entitlements.get(tenant.tenantId),
    ]);

    return {
      tenant: {
        id: tenant.tenantId,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
      },
      store,
      categories,
      features: entitlements.features,
    };
  }

  async getSettings(): Promise<StoreSettings> {
    const tenantId = this.tenantDb.tenantId;
    return this.cache.remember(
      cacheKeys.storeSettings(tenantId),
      this.config.redis.ttl.catalog,
      async () => {
        const row = await this.tenantDb.run((db) =>
          db.storeSettings.findUnique({ where: { id: 'singleton' } }),
        );
        if (!row) {
          // Only reachable if provisioning's SEED_DEFAULTS step never ran.
          throw Errors.internal('Store settings are missing for this tenant', { tenantId });
        }
        return this.toApi(row);
      },
    );
  }

  /** Pricing-relevant slice, kept separate so the money path has a narrow input. */
  async getPricingConfig(): Promise<PricingStoreConfig & { codEnabled: boolean; onlinePaymentEnabled: boolean; allowBackorder: boolean }> {
    const settings = await this.getSettings();
    return {
      currency: settings.currency,
      defaultTaxRateBps: settings.defaultTaxRateBps,
      taxInclusivePricing: settings.taxInclusivePricing,
      shippingFee: settings.shippingFee,
      freeShippingThreshold: settings.freeShippingThreshold,
      minOrderAmount: settings.minOrderAmount,
      codEnabled: settings.codEnabled,
      onlinePaymentEnabled: settings.onlinePaymentEnabled,
      allowBackorder: settings.allowBackorder,
    };
  }

  // ───────────────────────────────────────────────── presentation layer ──

  /**
   * The template catalogue, ranked for this store.
   *
   * Recommendations come from the tenant's business category, but the full
   * catalogue is always returned — a merchant is guided, never restricted.
   */
  async listTemplatesForTenant(businessCategory: string | null): Promise<{
    templates: TemplateDefinition[];
    recommendedIds: string[];
    active: StoreSettings['template'];
  }> {
    const ranked = recommendedTemplates(businessCategory);
    const recommended = ranked.filter((t) =>
      t.businessTypes.some(
        (type) =>
          businessCategory != null &&
          type.toLowerCase().replace(/[^a-z]/g, '') ===
            businessCategory.toLowerCase().replace(/[^a-z]/g, ''),
      ),
    );
    const settings = await this.getSettings();

    return {
      templates: ranked.length > 0 ? ranked : listTemplates(),
      recommendedIds: recommended.map((t) => t.id),
      active: settings.template,
    };
  }

  /**
   * Switches the storefront design and/or updates its customisation.
   *
   * **This is the only write in the system that changes how a store looks, and
   * it touches nothing else.** It updates three columns on the singleton
   * `store_settings` row. No product, variant, category, order, order item,
   * customer, payment, coupon or inventory row is read or written — there is
   * no code path from here that could. A merchant can move A → B → C → A and
   * arrive back at exactly the store they started with, catalogue intact.
   *
   * Customisation is *merged*, not replaced, and is stored unfiltered: a
   * section override naming a section the new template does not have is kept
   * on disk and simply not applied, so switching away and back restores the
   * merchant's layout rather than silently discarding it.
   */
  async updateTemplate(input: UpdateStoreTemplateInput): Promise<StoreSettings> {
    const tenantId = this.tenantDb.tenantId;

    // Read the **raw** stored row, not `getSettings()`.
    //
    // `getSettings()` sanitises customisation against whichever template is
    // currently active. Merging into that view and writing it back would
    // silently delete every preference the *outgoing* template happened not to
    // use — so a merchant who hid a section, switched away and switched back
    // would find it un-hidden. Reading the raw value is what makes the round
    // trip lossless, and is covered by `test/template-switching.e2e-spec.ts`.
    const stored = await this.tenantDb.run((db) =>
      db.storeSettings.findUnique({
        where: { id: 'singleton' },
        select: { templateId: true, templateVersion: true, templateCustomization: true },
      }),
    );
    if (!stored) throw Errors.internal('Store settings are missing for this tenant', { tenantId });

    const currentId = stored.templateId ?? defaultTemplateFor(null).id;

    // An unknown template id is a client error, not a silent fallback: the
    // merchant asked for a specific design and deserves to be told it is gone.
    const target = input.templateId
      ? getTemplate(input.templateId)
      : getTemplate(currentId, stored.templateVersion);

    if (!target) {
      throw Errors.badRequest('That storefront template is not available', {
        templateId: input.templateId ?? currentId,
      });
    }

    const rawCustomization = (stored.templateCustomization ??
      {}) as StoreSettings['template']['customization'];
    const switching = target.id !== currentId;
    const customization = input.customization
      ? { ...rawCustomization, ...input.customization }
      : rawCustomization;

    const row = await this.tenantDb.run((db) =>
      db.storeSettings.update({
        where: { id: 'singleton' },
        data: {
          templateId: target.id,
          templateVersion: target.version,
          templateCustomization: customization as never,
        },
      }),
    );

    await this.cache.del(cacheKeys.storeSettings(tenantId));

    this.audit.record('tenant', {
      action: AuditAction.SETTINGS_UPDATED,
      resourceType: 'store_template',
      resourceId: target.id,
      metadata: {
        from: currentId,
        to: target.id,
        version: target.version,
        switched: switching,
        customisationChanged: input.customization !== undefined,
      },
    });

    return this.toApi(row);
  }

  async updateSettings(input: UpdateStoreSettingsInput): Promise<StoreSettings> {
    const tenantId = this.tenantDb.tenantId;

    const row = await this.tenantDb.run(async (db) => {
      const existing = await db.storeSettings.findUnique({ where: { id: 'singleton' } });
      if (!existing) throw Errors.internal('Store settings are missing for this tenant');

      // Theme is merged rather than replaced, so a partial update from the
      // design page cannot wipe colours the merchant set elsewhere.
      const theme = input.theme
        ? { ...defaultStoreTheme, ...(existing.theme as object), ...input.theme }
        : existing.theme;

      return db.storeSettings.update({
        where: { id: 'singleton' },
        data: {
          ...pickDefined(input, [
            'storeName',
            'tagline',
            'description',
            'logoUrl',
            'faviconUrl',
            'contactEmail',
            'contactPhone',
            'whatsappNumber',
            'addressLine1',
            'addressLine2',
            'city',
            'state',
            'postalCode',
            'country',
            'currency',
            'currencySymbol',
            'defaultTaxRateBps',
            'taxInclusivePricing',
            'minOrderAmount',
            'shippingFee',
            'freeShippingThreshold',
            'codEnabled',
            'onlinePaymentEnabled',
            'allowBackorder',
            'isPublished',
            'maintenanceMessage',
          ]),
          theme: theme as never,
          ...(input.banners !== undefined
            ? {
                banners: input.banners.map((b, i) => ({
                  ...b,
                  id: b.id ?? `banner-${i + 1}`,
                  sortOrder: b.sortOrder ?? i,
                })) as never,
              }
            : {}),
          ...(input.businessHours !== undefined
            ? { businessHours: input.businessHours as never }
            : {}),
          ...(input.socialLinks !== undefined ? { socialLinks: input.socialLinks as never } : {}),
        },
      });
    });

    await this.cache.del(cacheKeys.storeSettings(tenantId));

    this.audit.record('tenant', {
      action: AuditAction.SETTINGS_UPDATED,
      resourceType: 'store_settings',
      resourceId: 'singleton',
      metadata: { fields: Object.keys(input) },
    });

    return this.toApi(row);
  }

  /**
   * Allocates the next order number inside the caller's transaction.
   *
   * The counter lives on the settings row and is incremented with the order in
   * one transaction, so two simultaneous checkouts cannot be handed the same
   * number — the row lock serialises them.
   */
  async nextOrderNumber(tx: {
    storeSettings: {
      update: (args: {
        where: { id: string };
        data: { orderSequence: { increment: number } };
        select: { orderSequence: true; orderPrefix: true };
      }) => Promise<{ orderSequence: number; orderPrefix: string }>;
    };
  }): Promise<string> {
    const updated = await tx.storeSettings.update({
      where: { id: 'singleton' },
      data: { orderSequence: { increment: 1 } },
      select: { orderSequence: true, orderPrefix: true },
    });
    const year = new Date().getFullYear();
    return `${updated.orderPrefix}-${year}-${String(updated.orderSequence).padStart(6, '0')}`;
  }

  private toApi(row: {
    id: string;
    storeName: string;
    tagline: string | null;
    description: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    theme: unknown;
    templateId: string | null;
    templateVersion: number;
    templateCustomization: unknown;
    banners: unknown;
    contactEmail: string | null;
    contactPhone: string | null;
    whatsappNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string;
    currency: string;
    currencySymbol: string;
    defaultTaxRateBps: number;
    taxInclusivePricing: boolean;
    minOrderAmount: number;
    shippingFee: number;
    freeShippingThreshold: number;
    codEnabled: boolean;
    onlinePaymentEnabled: boolean;
    allowBackorder: boolean;
    businessHours: unknown;
    socialLinks: unknown;
    isPublished: boolean;
    maintenanceMessage: string | null;
    updatedAt: Date;
  }): StoreSettings {
    return {
      id: row.id,
      storeName: row.storeName,
      tagline: row.tagline,
      description: row.description,
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      theme: { ...defaultStoreTheme, ...((row.theme ?? {}) as object) } as StoreSettings['theme'],
      template: this.toTemplateConfig(row),
      banners: (row.banners ?? []) as StoreSettings['banners'],
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      whatsappNumber: row.whatsappNumber,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
      currency: row.currency,
      currencySymbol: row.currencySymbol,
      defaultTaxRateBps: row.defaultTaxRateBps,
      taxInclusivePricing: row.taxInclusivePricing,
      minOrderAmount: row.minOrderAmount,
      shippingFee: row.shippingFee,
      freeShippingThreshold: row.freeShippingThreshold,
      codEnabled: row.codEnabled,
      onlinePaymentEnabled: row.onlinePaymentEnabled,
      allowBackorder: row.allowBackorder,
      businessHours: (row.businessHours ?? []) as StoreSettings['businessHours'],
      socialLinks: (row.socialLinks ?? {}) as Record<string, string>,
      isPublished: row.isPublished,
      maintenanceMessage: row.maintenanceMessage,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Resolves the stored presentation columns into a config the clients can use.
   *
   * A store provisioned before the template system existed has a NULL
   * `template_id`; rather than serving it a broken storefront, it is resolved
   * to a sensible catalogue default here — a read-time fallback, not a write.
   * The next time the merchant opens Store Design, the design they see is the
   * one they can then adopt explicitly.
   */
  private toTemplateConfig(row: {
    templateId: string | null;
    templateVersion: number;
    templateCustomization: unknown;
  }): StoreSettings['template'] {
    const template = row.templateId
      ? (getTemplate(row.templateId, row.templateVersion) ?? defaultTemplateFor(null))
      : defaultTemplateFor(null);

    return {
      templateId: template.id,
      templateVersion: template.version,
      // Sanitised for the *current* template on the way out; the unfiltered
      // value stays on disk so switching away and back is lossless.
      customization: sanitiseCustomization(
        template,
        (row.templateCustomization ?? {}) as StoreSettings['template']['customization'],
      ),
    };
  }
}

/** Copies only the keys the caller actually supplied, preserving explicit nulls. */
function pickDefined<T extends object, K extends keyof T>(source: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}
