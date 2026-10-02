/**
 * What counts against the monthly AI quota, defined once.
 *
 * The quota window is the calendar month in UTC. A request counts from the
 * moment it is reserved (PENDING) — that is what stops two concurrent requests
 * both slipping under the limit — and stops counting if it FAILS. Cache hits
 * never create a row, so they are free.
 */
export function aiQuotaWindowStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The first instant of the next quota window — when usage resets. */
export function aiQuotaWindowEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Accepts the master client or a transaction on it. */
interface AiGenerationCounter {
  aiGeneration: { count(args: { where: Record<string, unknown> }): Promise<number> };
}

export function countAiUsage(
  master: AiGenerationCounter,
  tenantId: string,
  now: Date = new Date(),
): Promise<number> {
  return master.aiGeneration.count({
    where: {
      tenantId,
      status: { in: ['PENDING', 'COMPLETED'] },
      createdAt: { gte: aiQuotaWindowStart(now) },
    },
  });
}
