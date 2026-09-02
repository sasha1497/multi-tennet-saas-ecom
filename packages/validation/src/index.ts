/**
 * @retailos/validation — one set of Zod schemas shared by:
 *   - the API   (wrapped with `createZodDto` so Swagger stays in sync)
 *   - both web apps (react-hook-form resolvers)
 *   - the mobile app
 *
 * Validating the same rules in one place is what stops the classic drift where
 * the browser accepts something the server rejects.
 */
export * from './primitives';
export * from './auth.schema';
export * from './catalog.schema';
export * from './inventory.schema';
export * from './cart.schema';
export * from './order.schema';
export * from './customer.schema';
export * from './store.schema';
export * from './platform.schema';
export * from './payment.schema';
