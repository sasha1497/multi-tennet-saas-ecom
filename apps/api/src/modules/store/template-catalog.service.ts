import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import {
  FAMILY_MINIMUM_PLAN,
  familyFeatureKey,
  getTemplate,
  isTemplateAllowed,
  listTemplates,
  type TemplateDefinition,
} from '@retailos/templates';
import type { TemplateAccess } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';

/**
 * The template catalogue as one tenant — or the platform — is allowed to see it.
 *
 * Three inputs, each owned elsewhere and none duplicated here:
 *   • the designs themselves   — `@retailos/templates` (code)
 *   • whether one is published — `template_publications` (super admin)
 *   • whether a store may use a family — `EntitlementsService` (plan + overrides)
 *
 * This is where a template is refused. The console draws locks from what this
 * returns, but the lock that matters is `assertCanActivate`, called by the one
 * write that switches a store's design.
 */
@Injectable()
export class TemplateCatalogService {
  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Template ids a super admin has withdrawn. Platform-wide, cached briefly. */
  async unpublishedIds(): Promise<Set<string>> {
    const ids = await this.cache.remember(cacheKeys.templatePublications(), 60, async () => {
      const rows = await this.master.templatePublication.findMany({
        where: { isPublished: false },
        select: { templateId: true },
      });
      return rows.map((r) => r.templateId);
    });
    return new Set(ids);
  }

  /** Per-template access for one tenant, in the order the templates are given. */
  async accessFor(
    tenantId: string,
    templates: readonly TemplateDefinition[],
  ): Promise<Record<string, TemplateAccess>> {
    const [entitlements, unpublished] = await Promise.all([
      this.entitlements.get(tenantId),
      this.unpublishedIds(),
    ]);

    return Object.fromEntries(
      templates.map((t) => [
        t.id,
        {
          family: t.tier,
          allowed: isTemplateAllowed(t, entitlements.features),
          published: !unpublished.has(t.id),
          featureKey: familyFeatureKey(t.tier),
          requiredPlan: FAMILY_MINIMUM_PLAN[t.tier],
        },
      ]),
    );
  }

  /**
   * Refuses a switch the store is not entitled to.
   *
   * Only *activating* a template is gated. A store already on a template —
   * because it was downgraded, or the template was unpublished — keeps
   * rendering it and keeps its customisation; nothing is reset or deleted.
   * The merchant is asked to choose an allowed design, not forced onto one.
   */
  async assertCanActivate(tenantId: string, template: TemplateDefinition): Promise<void> {
    const access = (await this.accessFor(tenantId, [template]))[template.id]!;

    if (!access.published) {
      throw Errors.badRequest('That storefront template is not available', {
        templateId: template.id,
      });
    }
    if (!access.allowed) {
      throw Errors.featureNotEntitled(access.featureKey);
    }
  }

  // ─────────────────────────────────────────────────────── platform admin ──

  /** Every template with its publish state and how many stores could use it. */
  async platformCatalogue() {
    const [unpublished, rows] = await Promise.all([
      this.unpublishedIds(),
      this.master.templatePublication.findMany(),
    ]);
    const byId = new Map(rows.map((r) => [r.templateId, r]));

    return listTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      family: t.tier,
      group: t.group,
      version: t.version,
      tagline: t.tagline,
      swatches: t.swatches,
      badges: t.badges ?? [],
      published: !unpublished.has(t.id),
      note: byId.get(t.id)?.note ?? null,
      updatedAt: byId.get(t.id)?.updatedAt.toISOString() ?? null,
      requiredPlan: FAMILY_MINIMUM_PLAN[t.tier],
    }));
  }

  async setPublished(
    templateId: string,
    isPublished: boolean,
    actorUserId: string | null,
    note?: string | null,
  ): Promise<void> {
    if (!getTemplate(templateId)) throw Errors.notFound('Template', templateId);

    await this.master.templatePublication.upsert({
      where: { templateId },
      create: { templateId, isPublished, note: note ?? null, updatedBy: actorUserId },
      update: { isPublished, note: note ?? null, updatedBy: actorUserId },
    });
    await this.cache.del(cacheKeys.templatePublications());
  }
}
