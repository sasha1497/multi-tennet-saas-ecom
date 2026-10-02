import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import {
  productSuggestionSchema,
  type ProductSuggestionInput,
  type ProductSuggestionProvider,
  type ProductSuggestionResult,
} from './ai-provider';

/** JSON Schema mirror of `productSuggestionSchema`, for structured outputs. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Product name as it would appear on a shelf label.' },
    shortDescription: { type: 'string', description: 'One sentence, under 200 characters.' },
    description: {
      type: 'string',
      description: 'Two or three short paragraphs for the product page. Plain text.',
    },
    categoryName: {
      type: 'string',
      description: "Exactly one of the store's category names, or an empty string.",
    },
    tags: { type: 'array', items: { type: 'string' }, description: 'Up to 8 search tags.' },
    metaTitle: { type: 'string', description: 'SEO title, under 60 characters.' },
    metaDescription: { type: 'string', description: 'SEO description, under 155 characters.' },
  },
  required: [
    'name',
    'shortDescription',
    'description',
    'categoryName',
    'tags',
    'metaTitle',
    'metaDescription',
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You write product listings for small local retail shops in India.
You are given one product photograph and, sometimes, a note from the shop owner.

Describe only what the photo and the note support. Do not invent a brand, material,
size, weight, certification, warranty or price that is not visible or stated; leave it
out instead. Write in plain, warm English a local shopper would trust — no hype words,
no emoji. If the photo is not of a sellable product, still return the fields, with the
name describing what is shown and the description saying the photo should be replaced.

For categoryName, choose exactly one name from the store's category list when one fits,
copied verbatim; otherwise return an empty string.`;

/**
 * Claude, via the official SDK, reading the product photograph directly.
 *
 * Structured outputs constrain the reply to the schema above; the result is
 * still parsed with zod before anything downstream sees it.
 */
@Injectable()
export class AnthropicProductProvider implements ProductSuggestionProvider {
  readonly name = 'anthropic';
  readonly model: string;
  readonly available = true;
  private client: Anthropic | null = null;

  constructor(private readonly config: AppConfigService) {
    this.model = config.ai.model;
  }

  /**
   * Built on first use, so a deployment on the mock provider never needs
   * Anthropic credentials just to boot. With no explicit key the SDK resolves
   * credentials from the environment (ANTHROPIC_API_KEY, or an
   * `ant auth login` profile on a dev machine).
   */
  private get anthropic(): Anthropic {
    this.client ??= new Anthropic(this.config.ai.apiKey ? { apiKey: this.config.ai.apiKey } : {});
    return this.client;
  }

  async suggestProduct(input: ProductSuggestionInput): Promise<ProductSuggestionResult> {
    const context = [
      `Store: ${input.storeName}`,
      input.businessCategory ? `The store sells: ${input.businessCategory}` : null,
      `The store's categories: ${input.categories.length ? input.categories.join(' | ') : '(none yet)'}`,
      input.hint ? `Note from the shop owner: ${input.hint}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    let response;
    try {
      response = await this.anthropic.beta.messages.create({
        model: this.model,
        max_tokens: 4000,
        // Short, well-specified extraction: low effort is enough and keeps
        // each generation cheap and quick for the merchant waiting on it.
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        // If the model declines, the API re-runs the request on a fallback
        // model inside the same call rather than failing the merchant.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: input.mediaType,
                  data: input.image.toString('base64'),
                },
              },
              { type: 'text', text: context },
            ],
          },
        ],
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        throw Errors.serviceUnavailable('The AI service is busy. Try again in a minute.');
      }
      if (err instanceof Anthropic.APIError) {
        throw Errors.serviceUnavailable('The AI service could not process this image.');
      }
      throw err;
    }

    if (response.stop_reason === 'refusal') {
      throw Errors.badRequest('This image could not be described. Try a different photo.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw Errors.serviceUnavailable('The AI reply was cut short. Please try again.');
    }

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw Errors.serviceUnavailable('The AI reply was not readable. Please try again.');
    }
    const suggestion = productSuggestionSchema.safeParse(parsed);
    if (!suggestion.success) {
      throw Errors.serviceUnavailable('The AI reply was incomplete. Please try again.');
    }

    return {
      suggestion: suggestion.data,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
