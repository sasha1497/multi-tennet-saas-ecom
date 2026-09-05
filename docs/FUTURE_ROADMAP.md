# Future roadmap

What is deliberately missing, why it was left out, and what it would take. The
gaps are listed before the ambitions, because knowing what a system does *not*
do is more useful than knowing what it might.

---

## Known gaps

These are things a production deployment will want soon. None are hidden behind
"TODO" comments in the code; they are absences, stated here.

### Testing

- **No front-end component or browser tests.** Both web apps are verified by
  typecheck, lint, a production build and manual exercise against the seeded
  tenants. A Playwright suite covering the checkout journey and the console's
  order workflow is the highest-value addition.
- **No load testing.** [SCALING.md](SCALING.md) reasons about where the system
  breaks first, but those limits are argued, not measured. A k6 run against a
  seeded stack would turn estimates into numbers — particularly the connection
  ceiling.
- **Payment tests use the mock provider.** The Razorpay adapter's signature and
  webhook verification are exercised at unit level, not against the live
  sandbox.

### Payments

- Partial refunds — the data model carries the amount, but the flow assumes a
  full refund.
- Merchant subscription billing is modelled (`plans`, `subscriptions`,
  `feature_entitlements`) but not wired to a gateway. Plan changes are recorded,
  not charged. This is the single largest gap between "working platform" and
  "business".
- Per-tenant payment routing exists in the schema (`payment_routes`) so
  merchants can eventually settle to their own gateway account; the flow is not
  built.

### Notifications

- No per-customer preferences or unsubscribe handling. Acceptable while every
  message is transactional; **required** before any marketing send.
- No WhatsApp Business integration, which matters commercially in this market —
  store settings already carry a WhatsApp number.

### Mobile

- Push registration flow is not in the UI, though the endpoint and the
  `push_tokens` table exist.
- No offline mode, no native payment sheet, no EAS build configuration, not
  submitted to either store.

### Operations

- Custom-domain support is modelled (`domains`) but needs on-demand certificate
  issuance and a domain-ownership verification flow before it can be exposed.
- No automated tenant data export ("give me my data"), which some jurisdictions
  require and which database-per-tenant makes unusually easy to build.
- Deprovisioning exists but the retention-then-drop lifecycle is manual.

---

## Near term

**Cross-tenant analytics rollups.** The architecture's real weak spot: platform
GMV means querying N databases. The answer is a rollup — each tenant publishes
periodic aggregates to the master database (or a warehouse), and platform
reporting reads those. Needed before a few hundred tenants, not after.

**Read replicas for reports and catalog.** Both are read-heavy and tolerate
seconds of staleness. The highest-value database optimisation available, and it
does not disturb tenant isolation.

**Subscription billing.** Charge for the plans that already exist. Recurring
mandates (UPI AutoPay / Razorpay Subscriptions), dunning, and enforcing plan
limits at the entitlement layer that is already wired in.

**Tenant data export and deletion.** Per-tenant databases make both close to
trivial. Worth building before someone asks under time pressure.

---

## Medium term

**Multi-location inventory.** Retailers with two shops want stock per location,
transfers between them, and per-location fulfilment. This is a real schema
change — inventory becomes keyed by location — and is best done before too many
merchants depend on the current shape.

**Shipping integration.** Delhivery / Shiprocket rate cards, label printing,
tracking webhooks. Currently orders carry a status but no carrier.

**Merchant-facing search improvements.** Faceting, synonyms and merchandising
rules go beyond what `pg_trgm` does comfortably. Per-tenant catalogs are small,
so this is a features question, not a scale one.

**Abandoned-cart recovery and basic marketing.** Requires the notification
preferences and unsubscribe work above first.

**Storefront themes.** Today a merchant picks colours; several layout templates
would differentiate shops more meaningfully. The theming mechanism already
supports it.

---

## Longer term

**Tenant sharding across clusters.** Groundwork is already in place —
`cluster_id` per tenant plus configured local reachability
([ADR-016](DECISION_LOG.md#adr-016)) — so moving a large merchant to their own
database instance is a dump, a restore, a row update and a cache eviction. What
is missing is the tooling to do it safely and observably.

**Marketplace mode.** Multiple merchants under one storefront, with split
settlement. A significant product change, not just a technical one.

**Merchant API and webhooks.** Let merchants integrate their own billing or
accounting software. The API is already versioned and documented; this is mostly
about scoped API keys and outbound webhook delivery.

**Point-of-sale.** The mobile app already scans barcodes. In-shop billing that
shares inventory with the online store is the feature most likely to win Indian
local retailers, because it replaces software they already pay for.

---

## Explicitly not planned

- **Kubernetes.** ECS Fargate is enough for this workload and costs far less
  operator time.
- **Multi-region.** Adds latency, cost and consistency problems a single-country
  retail platform does not have.
- **Moving to a shared-schema tenancy model to save cost.** It would forfeit the
  guarantee the product is sold on for a saving that does not matter. See
  [ADR-001](DECISION_LOG.md#adr-001).
- **A microservice split.** The module boundaries inside the API are clear and
  cheap to enforce; distributing them would buy deployment independence nobody
  currently needs and cost transactional integrity across order, payment and
  inventory — which is exactly where correctness matters most.

---

## If you only do three things

1. **Test a restore.** [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md). The
   scripts work; what is untested is *your* production copy of them.
2. **Wire up subscription billing.** The platform works; it does not yet earn.
3. **Add the Playwright checkout suite.** The isolation suite protects tenant
   data; nothing currently protects the purchase flow from a front-end
   regression.
