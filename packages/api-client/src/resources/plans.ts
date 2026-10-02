import type { HttpClient } from '../http';

/** A plan on sale, as the public pricing page sees it. */
export interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  /** Minor units. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  features: Record<string, boolean>;
  /** `-1` means unlimited. */
  limits: Record<string, number>;
}

/** Unauthenticated: the plans table's public rows, for pricing pages. */
export class PlansResource {
  constructor(private readonly http: HttpClient) {}

  list(): Promise<PublicPlan[]> {
    return this.http.get('/plans');
  }
}
