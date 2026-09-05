/* eslint-disable no-console -- this is a CLI: stdout IS the user interface, not stray debugging */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { defaultStoreTheme, storefrontUrl } from '@retailos/config';
import { slugify } from '@retailos/validation';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { installBigIntSerializer } from '@/common/utils/serialization';
import { CacheModule } from '@/core/cache/cache.service';
import { RequestContextService, createRequestContext } from '@/core/context/request-context';
import { DatabaseModule } from '@/core/database/database.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { LoggerModule } from '@/core/logger/logger.service';
import { ObservabilityModule } from '@/core/observability/metrics.service';
import { QueueModule } from '@/core/queue/queue.module';
import { SecurityModule } from '@/core/security/security.module';
import { PasswordService } from '@/core/security/password.service';
import { StorageModule } from '@/core/storage/storage.service';
import { TenantModule } from '@/core/tenant/tenant.module';
import { AuditModule } from '@/modules/audit/audit.service';
import { EntitlementsModule } from '@/modules/entitlements/entitlements.module';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import { TenantsModule } from '@/modules/tenants/tenants.module';
import { TenantProvisioningService } from '@/modules/tenants/tenant-provisioning.service';
import { SEED_COUPONS, SEED_PLANS, SEED_TENANTS, type SeedProduct } from './seed-data';

installBigIntSerializer();

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    ObservabilityModule,
    SecurityModule,
    CacheModule,
    DatabaseModule,
    TenantModule,
    QueueModule,
    StorageModule,
    AuditModule,
    EntitlementsModule,
    TenantsModule,
  ],
})
class SeedModule {}

/**
 * Development seed.
 *
 * Builds the whole platform end to end: plans, a super admin, three real-looking
 * merchants — each with its **own provisioned database** — and a populated
 * catalog, customer list and order history in every one.
 *
 * Fully idempotent: re-running updates rather than duplicating, so it is safe to
 * run against a database that is already partly seeded.
 *
 *   pnpm db:seed
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, { bufferLogs: false });

  const master = app.get(MasterPrismaService);
  const tenantDb = app.get(TenantDatabaseService);
  const provisioning = app.get(TenantProvisioningService);
  const entitlements = app.get(EntitlementsService);
  const passwords = app.get(PasswordService);
  const config = app.get(AppConfigService);
  const context = app.get(RequestContextService);

  // Seeding runs outside HTTP, so open a context for the audit/logging plumbing.
  await context.run(createRequestContext({ requestId: 'seed', method: 'CLI', path: 'seed' }), async () => {
    const log = (msg: string) => console.log(msg);

    log('\n━━━ RetailOS seed ━━━\n');

    // ---------------------------------------------------------------- plans --
    log('Plans');
    for (const plan of SEED_PLANS) {
      await master.plan.upsert({
        where: { code: plan.code },
        create: {
          code: plan.code,
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          currency: 'INR',
          trialDays: plan.trialDays,
          sortOrder: plan.sortOrder,
          features: plan.features as never,
          limits: plan.limits as never,
        },
        update: {
          name: plan.name,
          description: plan.description,
          priceMonthly: plan.priceMonthly,
          priceYearly: plan.priceYearly,
          features: plan.features as never,
          limits: plan.limits as never,
        },
      });
      log(`  ✓ ${plan.code}`);
    }

    // ---------------------------------------------------------- super admin --
    const superAdminPassword = config.seed.superAdminPassword;
    const superAdmin = await master.user.upsert({
      where: { email: config.seed.superAdminEmail },
      create: {
        email: config.seed.superAdminEmail,
        passwordHash: await passwords.hash(superAdminPassword),
        firstName: 'Platform',
        lastName: 'Admin',
        userType: 'PLATFORM',
        isSuperAdmin: true,
        emailVerified: true,
      },
      update: { isSuperAdmin: true, userType: 'PLATFORM' },
    });
    log(`\nSuper admin\n  ✓ ${superAdmin.email}`);

    // ------------------------------------------------------------- tenants --
    const defaultPassword = config.seed.defaultPassword;

    for (const seed of SEED_TENANTS) {
      log(`\n${seed.name} (${seed.slug})`);

      // -- owner --
      const owner = await master.user.upsert({
        where: { email: seed.owner.email },
        create: {
          email: seed.owner.email,
          phone: seed.owner.phone,
          passwordHash: await passwords.hash(defaultPassword),
          firstName: seed.owner.firstName,
          lastName: seed.owner.lastName,
          userType: 'MERCHANT',
          emailVerified: true,
        },
        update: {},
      });

      // -- tenant, domain, membership, subscription --
      const plan = await master.plan.findUniqueOrThrow({ where: { code: seed.plan } });
      const hostname = `${seed.slug}.${config.domain.platformDomain}`;

      let tenant = await master.tenant.findUnique({ where: { slug: seed.slug } });
      if (!tenant) {
        tenant = await master.tenant.create({
          data: {
            name: seed.name,
            slug: seed.slug,
            status: 'PROVISIONING',
            businessCategory: seed.businessCategory,
            contactEmail: seed.owner.email,
            contactPhone: seed.owner.phone,
            ownerUserId: owner.id,
          },
        });
        log('  ✓ tenant record');
      }

      await master.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
        create: {
          tenantId: tenant.id,
          userId: owner.id,
          role: 'OWNER',
          isActive: true,
          isDefault: true,
          joinedAt: new Date(),
        },
        update: { role: 'OWNER', isActive: true },
      });

      await master.domain.upsert({
        where: { hostname },
        create: {
          tenantId: tenant.id,
          hostname,
          type: 'SUBDOMAIN',
          isPrimary: true,
          isVerified: true,
        },
        update: { tenantId: tenant.id, isPrimary: true, isVerified: true },
      });

      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await master.subscription.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        },
        update: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: periodEnd },
      });
      await entitlements.syncPlanEntitlements(tenant.id, plan.id);

      // -- provision the physical database (idempotent) --
      log('  … provisioning database');
      await provisioning.provision(tenant.id);
      log('  ✓ database provisioned and migrated');

      // -- staff member, so the RBAC screens have something to show --
      const staffEmail = `staff@${seed.slug}.dev`;
      const staffUser = await master.user.upsert({
        where: { email: staffEmail },
        create: {
          email: staffEmail,
          passwordHash: await passwords.hash(defaultPassword),
          firstName: 'Sam',
          lastName: 'Staff',
          userType: 'MERCHANT',
          emailVerified: true,
        },
        update: {},
      });
      await master.tenantUser.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: staffUser.id } },
        create: {
          tenantId: tenant.id,
          userId: staffUser.id,
          role: 'MANAGER',
          isActive: true,
          joinedAt: new Date(),
        },
        update: {},
      });

      // ------------------------------------------------- tenant-side data --
      await tenantDb.runFor(tenant.id, async (db) => {
        // Store settings + branding
        await db.storeSettings.update({
          where: { id: 'singleton' },
          data: {
            storeName: seed.name,
            tagline: seed.tagline,
            description: `${seed.name} — ${seed.tagline}`,
            contactEmail: seed.owner.email,
            contactPhone: seed.owner.phone,
            whatsappNumber: seed.owner.phone,
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560001',
            theme: { ...defaultStoreTheme, ...seed.theme } as never,
            banners: [
              {
                id: 'banner-1',
                title: seed.tagline,
                subtitle: 'Free delivery on orders above ₹999',
                imageUrl: `https://picsum.photos/seed/${seed.slug}-hero/1600/600`,
                mobileImageUrl: `https://picsum.photos/seed/${seed.slug}-hero-m/800/800`,
                ctaLabel: 'Shop now',
                ctaHref: '/products',
                sortOrder: 0,
                isActive: true,
              },
            ] as never,
            defaultTaxRateBps: 500,
            taxInclusivePricing: true,
            shippingFee: 4900,
            freeShippingThreshold: 99900,
            minOrderAmount: 0,
            codEnabled: true,
            onlinePaymentEnabled: true,
            isPublished: true,
          },
        });

        // Categories
        const categoryIds = new Map<string, string>();
        for (const [index, cat] of seed.categories.entries()) {
          const row = await db.category.upsert({
            where: { slug: slugify(cat.name) },
            create: {
              name: cat.name,
              slug: slugify(cat.name),
              iconName: cat.icon,
              sortOrder: index,
              isActive: true,
              imageUrl: `https://picsum.photos/seed/${seed.slug}-${slugify(cat.name)}/400/400`,
            },
            update: { name: cat.name, iconName: cat.icon, sortOrder: index },
          });
          categoryIds.set(cat.name, row.id);
        }

        // Brands
        const brandIds = new Map<string, string>();
        for (const name of seed.brands) {
          const row = await db.brand.upsert({
            where: { slug: slugify(name) },
            create: { name, slug: slugify(name), isActive: true },
            update: { name },
          });
          brandIds.set(name, row.id);
        }

        // Products + variants + inventory
        for (const product of seed.products) {
          await seedProduct(db, product, categoryIds, brandIds);
        }

        // Coupons
        for (const coupon of SEED_COUPONS) {
          await db.coupon.upsert({
            where: { code: coupon.code },
            create: {
              code: coupon.code,
              description: coupon.description,
              discountType: coupon.discountType,
              discountValue: coupon.discountValue,
              maxDiscountAmount: coupon.maxDiscountAmount,
              minOrderAmount: coupon.minOrderAmount,
              perCustomerLimit: coupon.perCustomerLimit,
              isActive: true,
            },
            update: { isActive: true },
          });
        }

        // Customers
        const customerIds: string[] = [];
        for (const c of seed.customers) {
          const row = await db.customer.upsert({
            where: { email: c.email },
            create: {
              email: c.email,
              phone: c.phone,
              passwordHash: await passwords.hash(defaultPassword),
              firstName: c.firstName,
              lastName: c.lastName,
              emailVerified: true,
            },
            update: {},
          });
          customerIds.push(row.id);

          await db.address.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              customerId: row.id,
              type: 'HOME',
              fullName: `${c.firstName} ${c.lastName}`,
              phone: c.phone,
              line1: '221B, 4th Cross, Indiranagar',
              line2: 'Near Metro Station',
              city: 'Bengaluru',
              state: 'Karnataka',
              postalCode: '560038',
              country: 'IN',
              isDefault: true,
            },
            update: {},
          });
        }

        // Order history, so the dashboard charts are not empty on first login.
        await seedOrders(db, customerIds, seed.slug);
      });

      // Activate + record fresh counters.
      await master.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });

      log(`  ✓ catalog, customers and orders`);
      log(`  → ${storefrontUrl(seed.slug, config.domain)}`);
    }

    // ------------------------------------------------------------ summary --
    log('\n━━━ Seed complete ━━━\n');
    log('Sign in with:');
    log(`  Platform admin   ${config.seed.superAdminEmail} / ${superAdminPassword}`);
    for (const seed of SEED_TENANTS) {
      log(`  ${seed.name.padEnd(20)} ${seed.owner.email} / ${defaultPassword}   (OWNER)`);
      log(`  ${''.padEnd(20)} staff@${seed.slug}.dev / ${defaultPassword}   (MANAGER)`);
    }
    log('\nShopper accounts (per store):');
    for (const seed of SEED_TENANTS) {
      for (const c of seed.customers) {
        log(`  ${seed.slug.padEnd(12)} ${c.email} / ${defaultPassword}`);
      }
    }
    log('');
  });

  await app.close();
}

/** Creates or refreshes one product with all its variants and stock. */
async function seedProduct(
  db: Parameters<Parameters<TenantDatabaseService['runFor']>[1]>[0],
  product: SeedProduct,
  categoryIds: Map<string, string>,
  brandIds: Map<string, string>,
): Promise<void> {
  const slug = slugify(product.name);

  const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    // Already seeded — leave it alone so local edits survive a re-run.
    return;
  }

  const priceFrom = Math.min(...product.variants.map((v) => v.price));
  const mrpFrom = Math.min(...product.variants.map((v) => v.mrp));

  const created = await db.product.create({
    data: {
      name: product.name,
      slug,
      description: product.description,
      shortDescription: product.shortDescription,
      status: 'PUBLISHED',
      categoryId: categoryIds.get(product.category) ?? null,
      brandId: brandIds.get(product.brand) ?? null,
      options: product.options as never,
      tags: product.tags,
      isFeatured: product.featured ?? false,
      priceFrom,
      mrpFrom,
      taxRateBps: 500,
      searchText: [product.name, product.brand, product.category, ...product.tags]
        .join(' ')
        .toLowerCase(),
      publishedAt: new Date(),
      // A couple of plausible ratings so star displays are exercised.
      ratingAverage: 4 + Math.random(),
      ratingCount: Math.floor(Math.random() * 40) + 3,
      soldCount: Math.floor(Math.random() * 120),
      images: {
        create: [
          { url: product.image, alt: product.name, sortOrder: 0, isPrimary: true },
          { url: `${product.image}?v=2`, alt: `${product.name} alternate`, sortOrder: 1, isPrimary: false },
        ],
      },
    },
  });

  for (const [index, variant] of product.variants.entries()) {
    const created_ = await db.productVariant.create({
      data: {
        productId: created.id,
        sku: variant.sku,
        options: variant.options as never,
        label: Object.values(variant.options).join(' / ') || 'Default',
        price: variant.price,
        mrp: variant.mrp,
        sortOrder: index,
        isActive: true,
      },
    });

    await db.inventory.create({
      data: {
        variantId: created_.id,
        quantity: variant.stock,
        reserved: 0,
        lowStockThreshold: 5,
      },
    });

    await db.inventoryTransaction.create({
      data: {
        variantId: created_.id,
        type: 'INITIAL',
        quantityChange: variant.stock,
        quantityAfter: variant.stock,
        reason: 'Seeded opening stock',
      },
    });
  }
}

/**
 * Creates a spread of historical orders across the last 30 days, in varied
 * statuses, so the dashboard's charts, status breakdown and recent-orders list
 * all have something real to render.
 */
async function seedOrders(
  db: Parameters<Parameters<TenantDatabaseService['runFor']>[1]>[0],
  customerIds: string[],
  slugPrefix: string,
): Promise<void> {
  if (customerIds.length === 0) return;

  const alreadySeeded = await db.order.count();
  if (alreadySeeded > 0) return;

  const variants = await db.productVariant.findMany({
    where: { isActive: true, deletedAt: null },
    include: { product: { select: { id: true, name: true, slug: true, images: { take: 1 } } } },
    take: 40,
  });
  if (variants.length === 0) return;

  const statuses = [
    'DELIVERED',
    'DELIVERED',
    'DELIVERED',
    'SHIPPED',
    'PROCESSING',
    'CONFIRMED',
    'OUT_FOR_DELIVERY',
    'CANCELLED',
  ] as const;

  const settings = await db.storeSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  let sequence = settings.orderSequence;

  for (let i = 0; i < 24; i++) {
    const customerId = customerIds[i % customerIds.length];
    const status = statuses[i % statuses.length];
    const daysAgo = Math.floor((i / 24) * 30);
    const placedAt = new Date(Date.now() - daysAgo * 86_400_000 - i * 3_600_000);

    const lineCount = 1 + (i % 3);
    const chosen = Array.from({ length: lineCount }, (_, n) => variants[(i * 3 + n) % variants.length]);

    let subtotal = 0;
    const lines = chosen.map((v) => {
      const quantity = 1 + (i % 2);
      subtotal += v.price * quantity;
      return { variant: v, quantity };
    });

    const taxAmount = Math.round(subtotal - subtotal / 1.05);
    const shipping = subtotal >= settings.freeShippingThreshold ? 0 : settings.shippingFee;
    const total = subtotal + shipping;

    sequence += 1;
    const orderNumber = `${settings.orderPrefix}-${placedAt.getFullYear()}-${String(sequence).padStart(6, '0')}`;

    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });

    const order = await db.order.create({
      data: {
        orderNumber,
        customerId,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        status,
        paymentStatus: status === 'CANCELLED' ? 'FAILED' : 'PAID',
        paymentMethod: i % 3 === 0 ? 'COD' : 'UPI',
        subtotal,
        discountAmount: 0,
        taxAmount,
        shippingAmount: shipping,
        totalAmount: total,
        currency: 'INR',
        taxInclusive: true,
        shippingAddress: {
          fullName: `${customer.firstName} ${customer.lastName}`,
          phone: customer.phone ?? '9800000000',
          line1: '221B, 4th Cross, Indiranagar',
          line2: 'Near Metro Station',
          landmark: null,
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560038',
          country: 'IN',
        } as never,
        idempotencyKey: `seed:${slugPrefix}:${randomUUID()}`,
        placedAt,
        confirmedAt: status === 'CANCELLED' ? null : placedAt,
        deliveredAt: status === 'DELIVERED' ? new Date(placedAt.getTime() + 3 * 86_400_000) : null,
        cancelledAt: status === 'CANCELLED' ? new Date(placedAt.getTime() + 3_600_000) : null,
        cancellationReason: status === 'CANCELLED' ? 'Customer changed their mind' : null,
      },
    });

    for (const line of lines) {
      const lineSubtotal = line.variant.price * line.quantity;
      await db.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.variant.product.id,
          variantId: line.variant.id,
          productName: line.variant.product.name,
          productSlug: line.variant.product.slug,
          variantLabel: line.variant.label,
          sku: line.variant.sku,
          imageUrl: line.variant.product.images[0]?.url ?? null,
          variantOptions: line.variant.options as never,
          unitPrice: line.variant.price,
          mrp: line.variant.mrp,
          quantity: line.quantity,
          discountAmount: 0,
          taxRateBps: 500,
          taxAmount: Math.round(lineSubtotal - lineSubtotal / 1.05),
          lineTotal: lineSubtotal,
        },
      });
    }

    await db.orderStatusHistory.create({
      data: { orderId: order.id, toStatus: 'PENDING', changedByType: 'CUSTOMER', createdAt: placedAt },
    });
    if (status !== 'CANCELLED') {
      await db.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: 'PENDING',
          toStatus: status,
          changedByType: 'STAFF',
          createdAt: new Date(placedAt.getTime() + 7_200_000),
        },
      });
    }

    await db.payment.create({
      data: {
        orderId: order.id,
        provider: i % 3 === 0 ? 'cod' : 'mock',
        method: i % 3 === 0 ? 'COD' : 'UPI',
        status: status === 'CANCELLED' ? 'FAILED' : 'PAID',
        amount: total,
        currency: 'INR',
        idempotencyKey: `seed-pay:${order.id}`,
        paidAt: status === 'CANCELLED' ? null : placedAt,
      },
    });
  }

  await db.storeSettings.update({
    where: { id: 'singleton' },
    data: { orderSequence: sequence },
  });

  // Refresh the per-customer aggregates the merchant console displays.
  for (const customerId of customerIds) {
    const agg = await db.order.aggregate({
      where: { customerId, status: { not: 'CANCELLED' } },
      _sum: { totalAmount: true },
      _count: { _all: true },
      _max: { placedAt: true },
    });
    await db.customer.update({
      where: { id: customerId },
      data: {
        orderCount: agg._count._all,
        totalSpent: BigInt(agg._sum.totalAmount ?? 0),
        lastOrderAt: agg._max.placedAt,
      },
    });
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});
