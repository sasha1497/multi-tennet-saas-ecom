/**
 * @retailos/types — the single shared contract between the API, both web apps
 * and the mobile app.
 *
 * Nothing in here may import runtime dependencies: it must stay a pure type +
 * const-enum package so React Native, Next.js server components and NestJS can
 * all consume it.
 */
export * from './common';
export * from './enums';
export * from './permissions';
export * from './auth';
export * from './tenant';
export * from './store';
export * from './catalog';
export * from './inventory';
export * from './customer';
export * from './cart';
export * from './order';
export * from './payment';
export * from './platform';
export * from './reports';
export * from './notification';
