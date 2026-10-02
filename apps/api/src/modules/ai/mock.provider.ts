import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfigService } from '@/config/config.module';
import type {
  ProductSuggestionInput,
  ProductSuggestionProvider,
  ProductSuggestionResult,
} from './ai-provider';

/**
 * Deterministic stand-in for development and tests.
 *
 * Unavailable in production for the same reason the mock payment gateway is:
 * a merchant must never be charged a generation for text nobody generated.
 */
@Injectable()
export class MockProductProvider implements ProductSuggestionProvider {
  readonly name = 'mock';
  readonly model = 'mock-v1';
  readonly available: boolean;

  constructor(config: AppConfigService) {
    this.available = !config.isProd;
  }

  async suggestProduct(input: ProductSuggestionInput): Promise<ProductSuggestionResult> {
    const tag = createHash('sha256').update(input.image).digest('hex').slice(0, 6);
    const category = input.categories[0] ?? '';
    const base = input.hint?.trim() || `Store pick ${tag.toUpperCase()}`;

    return {
      suggestion: {
        name: base.slice(0, 160),
        shortDescription: `A ${category ? category.toLowerCase() : 'store'} favourite from ${input.storeName}.`,
        description:
          `${base} — photographed in store and ready to ship.\n\n` +
          'This description was produced by the development AI provider. Replace it with your ' +
          'own words, or switch AI_PROVIDER to anthropic for real suggestions.',
        categoryName: category,
        tags: ['new', tag],
        metaTitle: `${base} | ${input.storeName}`.slice(0, 70),
        metaDescription: `Buy ${base} from ${input.storeName}.`.slice(0, 160),
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
