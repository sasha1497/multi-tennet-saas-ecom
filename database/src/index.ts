/**
 * @retailos/database — owns both Prisma schemas, their generated clients and
 * the versioned tenant migrations.
 *
 * Importing the two clients through this one package keeps the rest of the
 * codebase from ever reaching into `generated/` directly, and makes the
 * master/tenant split explicit at every call site:
 *
 *   import { MasterPrismaClient, TenantPrismaClient } from '@retailos/database';
 */
export * from './clients';
export * from './migrations';
