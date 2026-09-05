# Web applications

Two Next.js 14 apps (app router), one shared component library, one shared API
client.

---

## Storefront (`apps/storefront-web`)

**One deployment renders every merchant's shop.** The tenant comes from the
incoming hostname; nothing is per-merchant except data and theme.

### Routes

```
/                                   home — banners, featured, categories
/products                           catalog with filters and sort
/products/[slug]                    product detail, variants, reviews
/offers                             active coupons
/cart                               cart with live totals
/checkout                           address, payment method, place order
/checkout/mock-gateway              development payment simulator
/order-confirmed/[orderNumber]      confirmation
/account                            profile
/account/orders                     order history
/account/orders/[orderNumber]       order detail and tracking
/account/addresses                  address book
/account/wishlist                   wishlist
/login  /register                   customer auth
```

### Tenant resolution and theming

The root layout resolves the tenant **server-side**, fetches the store's
branding, and writes the merchant's colours onto `<html>` as CSS custom
properties before anything renders:

```
--color-primary: 31 71 224;    /* KickZone   */
--color-accent:  249 115 22;
--radius:        0.5rem;
```

Tailwind's preset consumes them as `rgb(var(--color-primary) / <alpha-value>)`,
so every utility class is brand-aware without a per-tenant build.

Doing this on the server is the whole point: client-side theming after hydration
produces a visible flash of the wrong brand colour on every page load.
[ADR-012](DECISION_LOG.md#adr-012).

Server-side fetches go through `serverApi()` (`src/lib/server-api.ts`), which
forwards the incoming hostname to the API as `X-Forwarded-Host` — `Host` is a
forbidden fetch header and `undici` drops it silently, which would resolve every
SSR request to no tenant at all. The helper reads `x-forwarded-host` first and
falls back to `host`, matching the API's own rule so a proxy that rewrites one
of them does not break rendering.

### Rendering strategy

Storefront content is server-rendered with `revalidate: 60`, so a burst of
visitors does not become a burst of API calls while a price change still appears
within a minute. Cart, checkout and account pages are client components with
TanStack Query — they are per-user and must never be cached.

### Guest carts

A shopper can fill a cart before signing in. The API issues a signed guest token
in `X-Guest-Token`; the client stores and replays it, and `POST /cart/merge`
folds the guest cart into the customer's cart on login.

---

## Merchant console (`apps/merchant-web`)

The merchant back office and, for super admins, the platform admin.

### Routes

```
/login  /register                   merchant auth
/(console)                          dashboard: revenue, orders, low stock
/(console)/welcome                  post-signup, while the tenant provisions
/(console)/products                 catalog list
/(console)/products/new             create
/(console)/products/[id]            edit, variants, images
/(console)/categories               category tree
/(console)/inventory                stock levels, adjustments, thresholds
/(console)/orders                   order queue
/(console)/orders/[id]              detail, status workflow, notes
/(console)/customers                customer list and detail
/(console)/coupons                  coupon management
/(console)/reviews                  review moderation
/(console)/reports                  sales, customers, inventory
/(console)/store                    store profile, branding, policies
/(console)/staff                    staff and roles
/(console)/settings                 account settings
/(console)/platform                 super admin: tenant directory
/(console)/platform/[id]            tenant detail, provisioning, plan
/(console)/platform/system          service health, queues, audit log
```

The console is client-rendered — it is behind auth, personalised, and gains
nothing from SSR.

### Tenant selection

There is no tenant hostname here, so the tenant comes from the caller's
membership. An owner with several stores gets a switcher, which sets
`X-Tenant-Id` on subsequent requests. That header is a *hint*: the API
revalidates it against membership and it can never widen access
([TENANCY.md](TENANCY.md)).

### Permissions in the UI

The console imports the same permission catalogue the API enforces
(`@retailos/types`), so a button is hidden for exactly the reason the API would
refuse the call. The UI check is convenience; the API check is the control.

---

## Shared UI (`packages/ui`)

Design tokens in `src/styles.css`, primitives in `src/primitives`, data display
in `src/data`, charts in `src/charts`.

Tokens are declared three times over — for light, under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme='light'])`,
and again under `:root[data-theme='dark']` — so an explicit theme choice wins in
both directions and the system default still works.

### Charts

Hand-drawn SVG (`area-chart.tsx`, `bar-list.tsx`, `stat-tile.tsx`) rather than a
charting library: three chart types with a consistent look cost less as ~400
lines of SVG than as a dependency plus the CSS to make it match.

They follow one rule deliberately: **a single hue for data, with identity
carried by text labels rather than colour**. Colour-blind readers lose nothing,
and status colours stay reserved for status. Stat tiles never signal a delta
with colour alone — the arrow and the sign carry it. [ADR-015](DECISION_LOG.md#adr-015).

---

## Shared API client (`packages/api-client`)

One typed client for all three front-ends:

- Unwraps the response envelope, so callers see `data` and never
  `response.data.data`.
- Throws typed errors carrying the API's error code.
- **Single-flight refresh**: a 401 triggers one refresh, and every request that
  arrives during it waits for that same refresh rather than starting its own —
  which would defeat refresh-token rotation and revoke the session family.
- Carries tenant hints (`X-Tenant-Id`, `X-Tenant-Slug`) and the guest token.

---

## Conventions

- Forms validate with the same Zod schemas the API validates with — the client
  cannot accept something the server will reject.
- Money is formatted at the edge with `formatMoney` from `@retailos/config`.
  Integer paise everywhere else.
- Server components fetch; client components mutate. Anything with `useState` or
  an event handler is `'use client'`.
- Loading states are skeletons, not spinners, so layout does not jump.

## Building

```bash
pnpm --filter @retailos/storefront-web dev     # :3000
pnpm --filter @retailos/merchant-web dev       # :3001
pnpm build
```

Both use `output: 'standalone'` and share one Dockerfile parameterised by
`APP_NAME` ([DOCKER.md](DOCKER.md)).

## Not implemented

No component or browser tests; both apps are verified by typecheck, lint, a
production build and manual exercise against the seeded tenants. See
[TESTING.md](TESTING.md#what-is-not-covered).
