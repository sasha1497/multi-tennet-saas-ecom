import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { FeatureKey, LimitKey, type CategoryTreeNode } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { StorageService } from '@/core/storage/storage.service';
import { CategoriesService } from '@/modules/catalog/categories.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import { StoreService } from '@/modules/store/store.service';
import {
  PRODUCT_PROMPT_VERSION,
  PRODUCT_SUGGESTION_PROVIDER,
  productSuggestionSchema,
  type ProductSuggestion,
  type ProductSuggestionProvider,
} from './ai-provider';
import { aiQuotaWindowEnd, countAiUsage } from './ai-usage';

const KIND = 'product_from_image';

/**
 * Raw bytes accepted for one image. Comfortably under the vision API's
 * per-image limit once base64-encoded, so an oversize photo is refused here
 * with a useful message rather than failing upstream after being metered.
 */
const MAX_IMAGE_BYTES = 3_750_000;

export interface ProductSuggestionResponse {
  suggestion: ProductSuggestion & { categoryId: string | null };
  /** True when an identical earlier request was reused, free of charge. */
  cached: boolean;
  usage: { used: number; limit: number; resetsAt: string };
}

/**
 * Smart Product Upload: a product photo in, a draft listing out.
 *
 *   photo (already in the tenant's storage) ──▶ entitlement + quota
 *     ──▶ cache lookup ──▶ provider ──▶ draft for the merchant to review
 *
 * Every rule that costs money is enforced here, server-side:
 *   • the plan must include `ai_product_upload`
 *   • the month's generations must be under `ai_generations_per_month` —
 *     there is no unlimited setting by design
 *   • an identical request (same image bytes, same note, same category list,
 *     same prompt version) returns the stored answer and is not charged
 *
 * Nothing is published. The result fills the product form; saving goes through
 * the ordinary product endpoints and their own limits.
 */
@Injectable()
export class AiService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly storage: StorageService,
    private readonly categories: CategoriesService,
    private readonly store: StoreService,
    private readonly entitlements: EntitlementsService,
    private readonly context: RequestContextService,
    @Inject(PRODUCT_SUGGESTION_PROVIDER) private readonly provider: ProductSuggestionProvider,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('AI');
  }

  async usage(tenantId: string) {
    const [used, limit] = await Promise.all([
      countAiUsage(this.master, tenantId),
      this.entitlements.getLimit(tenantId, LimitKey.AI_GENERATIONS_PER_MONTH),
    ]);
    return {
      used,
      limit: Math.max(limit, 0),
      resetsAt: aiQuotaWindowEnd().toISOString(),
      provider: this.provider.name,
      available: this.provider.available,
    };
  }

  async suggestProductFromImage(
    objectKey: string,
    hint?: string,
  ): Promise<ProductSuggestionResponse> {
    const tenantId = this.tenantDb.tenantId;
    await this.entitlements.assertFeature(tenantId, FeatureKey.AI_PRODUCT_UPLOAD);

    if (!this.provider.available) {
      throw Errors.serviceUnavailable('AI product suggestions are not available on this deployment.');
    }

    // `get` enforces that the key sits under this tenant's prefix — one store
    // can never ask the AI to describe another store's photograph.
    const image = await this.storage.get(tenantId, objectKey);
    if (!image) throw Errors.notFound('Image', objectKey);
    if (image.length > MAX_IMAGE_BYTES) {
      throw Errors.badRequest('That photo is too large for AI suggestions. Use one under 3.5 MB.');
    }
    const mediaType = sniffImage(image);
    if (!mediaType) {
      throw Errors.badRequest('AI suggestions need a JPEG, PNG or WebP photo.');
    }

    const [settings, tree, tenant] = await Promise.all([
      this.store.getSettings(),
      this.categories.tree(),
      this.master.tenant.findUnique({ where: { id: tenantId }, select: { businessCategory: true } }),
    ]);
    const categories = flattenCategories(tree);
    const categoryNames = categories.map((c) => c.name).sort();
    const cleanHint = hint?.trim().slice(0, 300) || undefined;

    const inputHash = createHash('sha256')
      .update(`${KIND}\0${PRODUCT_PROMPT_VERSION}\0${this.provider.model}\0`)
      .update(image)
      .update(`\0${cleanHint ?? ''}\0${categoryNames.join('\u0001')}`)
      .digest('hex');

    // ── cache ────────────────────────────────────────────────────────────
    const cached = await this.master.aiGeneration.findFirst({
      where: { tenantId, kind: KIND, inputHash, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    if (cached?.output) {
      const parsed = productSuggestionSchema.safeParse(cached.output);
      if (parsed.success) {
        return {
          suggestion: withCategoryId(parsed.data, categories),
          cached: true,
          usage: await this.usageSummary(tenantId),
        };
      }
    }

    // ── reserve one generation against the quota ────────────────────────
    const limit = await this.entitlements.getLimit(tenantId, LimitKey.AI_GENERATIONS_PER_MONTH);
    const reservation = await this.master.$transaction(async (tx) => {
      // Serialises reservations per tenant so two concurrent requests cannot
      // both read "one left" and both proceed. Held for milliseconds only —
      // the provider call happens after this transaction commits.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${tenantId}))`;
      const used = await countAiUsage(tx, tenantId);
      // Unmetered (-1) is not honoured for AI: treat it as zero headroom so a
      // misconfigured plan fails closed rather than open.
      const ceiling = Math.max(limit, 0);
      if (used >= ceiling) throw Errors.planLimitReached(LimitKey.AI_GENERATIONS_PER_MONTH, ceiling, used);

      return tx.aiGeneration.create({
        data: {
          tenantId,
          kind: KIND,
          inputHash,
          status: 'PENDING',
          provider: this.provider.name,
          model: this.provider.model,
          userId: this.context.userId,
        },
      });
    });

    // ── generate ─────────────────────────────────────────────────────────
    try {
      const result = await this.provider.suggestProduct({
        image,
        mediaType,
        categories: categoryNames,
        storeName: settings.storeName,
        businessCategory: tenant?.businessCategory ?? null,
        hint: cleanHint,
      });

      await this.master.aiGeneration.update({
        where: { id: reservation.id },
        data: {
          status: 'COMPLETED',
          output: result.suggestion as never,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });

      this.logger.info('Product suggestion generated', {
        tenantId,
        provider: this.provider.name,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });

      return {
        suggestion: withCategoryId(result.suggestion, categories),
        cached: false,
        usage: await this.usageSummary(tenantId),
      };
    } catch (err) {
      // A failed generation releases its reservation: the merchant is not
      // charged for an answer they never received.
      await this.master.aiGeneration.update({
        where: { id: reservation.id },
        data: {
          status: 'FAILED',
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      });
      throw err;
    }
  }

  private async usageSummary(tenantId: string) {
    const { used, limit, resetsAt } = await this.usage(tenantId);
    return { used, limit, resetsAt };
  }
}

function flattenCategories(nodes: CategoryTreeNode[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const walk = (list: CategoryTreeNode[]) => {
    for (const node of list) {
      out.push({ id: node.id, name: node.name });
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Maps the model's category name back to a real id — never trusts a new one. */
function withCategoryId(
  suggestion: ProductSuggestion,
  categories: { id: string; name: string }[],
): ProductSuggestion & { categoryId: string | null } {
  const wanted = suggestion.categoryName.trim().toLowerCase();
  const match = wanted ? categories.find((c) => c.name.toLowerCase() === wanted) : undefined;
  return { ...suggestion, categoryName: match?.name ?? '', categoryId: match?.id ?? null };
}

/** Identifies an image by its magic number, not by anything a client claimed. */
function sniffImage(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
