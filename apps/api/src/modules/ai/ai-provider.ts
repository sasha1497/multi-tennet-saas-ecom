import { z } from 'zod';

/**
 * What Smart Product Upload hands back for the merchant to review.
 *
 * Never published directly: the console fills the product form with it and the
 * merchant edits and saves through the ordinary product endpoints, so every
 * validation and plan limit on products still applies.
 */
export const productSuggestionSchema = z.object({
  name: z.string().trim().min(1).max(160),
  shortDescription: z.string().trim().max(300),
  description: z.string().trim().max(4000),
  /** One of the store's existing category names, or '' when none fits. */
  categoryName: z.string().trim().max(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  metaTitle: z.string().trim().max(70),
  metaDescription: z.string().trim().max(160),
});
export type ProductSuggestion = z.infer<typeof productSuggestionSchema>;

export interface ProductSuggestionInput {
  image: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** The store's category names, so the model picks one rather than inventing one. */
  categories: string[];
  storeName: string;
  businessCategory: string | null;
  /** Optional words from the merchant: brand, material, anything the photo cannot show. */
  hint?: string;
}

export interface ProductSuggestionResult {
  suggestion: ProductSuggestion;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * The one seam between RetailOS and an AI vendor.
 *
 * Metering, caching, quotas and tenant scoping all live in `AiService`, above
 * this interface, so swapping vendors is a new class here and a config value —
 * nothing a merchant can observe changes.
 */
export interface ProductSuggestionProvider {
  readonly name: string;
  readonly model: string;
  /** False when the provider must not be used on this deployment. */
  readonly available: boolean;
  suggestProduct(input: ProductSuggestionInput): Promise<ProductSuggestionResult>;
}

export const PRODUCT_SUGGESTION_PROVIDER = Symbol('PRODUCT_SUGGESTION_PROVIDER');

/**
 * Bumped whenever the prompt or schema changes, so a cached answer produced by
 * an older prompt is not served as if the new one had produced it.
 */
export const PRODUCT_PROMPT_VERSION = 'product-v1';
