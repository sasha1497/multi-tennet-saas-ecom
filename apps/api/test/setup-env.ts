/**
 * Test-environment tuning, applied before the app boots.
 *
 * The e2e suites sign in dozens of times from a single IP, which is exactly
 * what the auth rate limiter exists to stop. Left at production values the
 * second suite in a run fails with 429s that say nothing about tenant
 * isolation — the thing actually under test.
 *
 * The limiter itself is NOT disabled: `tenant-isolation.e2e-spec.ts` still
 * asserts that unauthenticated and forged requests are refused, and a limit of
 * 10_000 still trips on a genuine runaway loop.
 *
 * These two variables do not reach the auth routes — those carry their own
 * per-action limits in the decorator (ten logins per five minutes, five
 * registrations per hour). `bootstrapTestApp` clears the rate-limit counters
 * before each suite for that reason.
 */
process.env.AUTH_RATE_LIMIT_LIMIT = process.env.AUTH_RATE_LIMIT_LIMIT ?? '10000';
process.env.RATE_LIMIT_LIMIT = process.env.RATE_LIMIT_LIMIT ?? '10000';

// The suite exercises metering and caching, not a vendor: never spend real AI
// credits from a test run, whatever the developer's .env says.
process.env.AI_PROVIDER = 'mock';
