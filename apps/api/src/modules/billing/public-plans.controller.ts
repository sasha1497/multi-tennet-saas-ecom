import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { Public } from '@/common/decorators';

/**
 * The plans on sale, for the public pricing page.
 *
 * Read-only and unauthenticated, so the marketing site shows the prices the
 * plans table actually charges instead of a copy that drifts. Only public,
 * active plans; only what a price list needs — no ids, no sort keys, nothing
 * about any tenant.
 */
@ApiTags('Plans')
@Controller('plans')
@Public()
export class PublicPlansController {
  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Plans currently on sale, with prices, trials, features and limits' })
  list() {
    return this.cache.remember('platform:public-plans', 60, async () => {
      const plans = await this.master.plan.findMany({
        where: { isActive: true, isPublic: true },
        orderBy: { sortOrder: 'asc' },
      });
      return plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        currency: plan.currency,
        trialDays: plan.trialDays,
        features: plan.features as Record<string, boolean>,
        limits: plan.limits as Record<string, number>,
      }));
    });
  }
}
