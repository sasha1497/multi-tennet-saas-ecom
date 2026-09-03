import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { TokenAudience } from '@retailos/types';
import { verifyPaymentSchema } from '@retailos/validation';
import { Audience, Public, RequireTenant } from '@/common/decorators';
import { NoEnvelope } from '@/common/interceptors/transform.interceptor';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { PaymentsService } from './payments.service';

class VerifyPaymentDto extends createZodDto(verifyPaymentSchema) {}

@ApiTags('Payments')
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: AppConfigService,
  ) {}

  @Post('payments/verify')
  @Audience(TokenAudience.CUSTOMER)
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, ttl: 300, bucket: 'payment:verify', by: 'user' })
  @ApiOperation({
    summary: 'Verify a gateway callback',
    description:
      'Called by the storefront/mobile client after the gateway SDK closes. The HMAC signature ' +
      'is verified server-side; an invalid signature never marks an order paid.',
  })
  verify(@Body() dto: VerifyPaymentDto) {
    return this.payments.verify(dto);
  }

  /**
   * Gateway webhook.
   *
   * Unauthenticated by necessity — the gateway has no credentials of ours — so
   * the *signature over the raw body* is the entire authentication story. The
   * raw buffer is preserved by the `rawBody` option in main.ts; re-serialising
   * parsed JSON would change the bytes and break every signature.
   *
   * Always answers 200 for anything it can process or safely ignore, so a
   * gateway does not enter an exponential-backoff retry storm over an event we
   * legitimately do not care about.
   */
  @Post('webhooks/payments/:provider')
  @Public()
  @HttpCode(HttpStatus.OK)
  @NoEnvelope()
  @ApiExcludeEndpoint()
  async webhook(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<{ received: boolean }> {
    if (provider !== this.payments.providerName) {
      // Do not confirm or deny which providers are configured.
      return { received: true };
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    await this.payments.handleWebhook(rawBody, headers);
    return { received: true };
  }

  /**
   * Drives the mock gateway in local development.
   *
   * Produces a genuine HMAC with the mock provider's key and feeds it through
   * the normal `verify()` path, so the signature check under test is the real
   * one. Refused outright in production.
   */
  @Post('payments/mock/:paymentId/:outcome')
  @Audience(TokenAudience.CUSTOMER)
  @RequireTenant()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Development only: simulate a payment outcome' })
  simulate(@Param('paymentId') paymentId: string, @Param('outcome') outcome: string) {
    if (this.config.isProd) throw Errors.forbidden('Not available');
    if (outcome !== 'success' && outcome !== 'failure') {
      throw Errors.badRequest('Outcome must be "success" or "failure"');
    }
    return this.payments.simulate(paymentId, outcome);
  }
}
