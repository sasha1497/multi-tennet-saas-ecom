# API reference

Base path: `/api/v1`. Interactive docs (generated from the same Zod schemas the
API validates with): `http://localhost:4000/docs`.

## Conventions

**Every success** looks like this:

```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 },
  "requestId": "1d449231-f6d1-47f0-8702-aaed639a90cc"
}
```

**Every failure** looks like this:

```json
{
  "success": false,
  "error": {
    "code": "TENANT_MEMBERSHIP_REQUIRED",
    "message": "You do not have access to this store",
    "details": null
  },
  "requestId": "1d449231-f6d1-47f0-8702-aaed639a90cc"
}
```

`meta` appears on paginated responses. `requestId` appears on every response and
is echoed in the logs — quote it in a bug report and the whole request can be
found.

**Money** is always a non-negative integer in the minor unit. `129900` is
₹1,299.00. Never send or expect a decimal.

**Dates** are ISO 8601 with an offset.

**Pagination** is `?page=1&limit=20`, with `limit` capped server-side.

### Headers

| Header | Direction | Meaning |
| --- | --- | --- |
| `Authorization: Bearer <jwt>` | → | Access token |
| `X-Tenant-Id` | → | Merchant console only: which of *your* stores to act on. Verified against your membership |
| `X-Tenant-Slug` | → | Mobile only: selects a storefront, exactly as a hostname would |
| `X-Guest-Token` | ↔ | Anonymous cart identity |
| `Idempotency-Key` | → | Safe checkout retries |
| `X-Request-Id` | ↔ | Correlation id; generated if absent |

A tenant id in a request **body** or **query string** is ignored. Always.

### Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Body/query failed schema validation; `details` carries field errors |
| `BAD_REQUEST` | 400 | Malformed request |
| `UNAUTHORIZED` | 401 | Missing, expired or forged token |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `TENANT_MEMBERSHIP_REQUIRED` | 403 | No live membership for the requested store |
| `NOT_FOUND` | 404 | No such resource *in this tenant* |
| `TENANT_NOT_FOUND` | 404 | Hostname does not resolve to a store |
| `DUPLICATE_RESOURCE` | 409 | Unique constraint |
| `CONCURRENT_MODIFICATION` | 409 | Optimistic lock lost; re-read and retry |
| `INSUFFICIENT_STOCK` | 409 | Not enough available stock |
| `INVALID_STATE_TRANSITION` | 409 | Illegal order status change |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded the cap |
| `RATE_LIMITED` | 429 | Slow down |
| `TENANT_PROVISIONING` | 503 | Store is still being created |
| `TENANT_SUSPENDED` | 503 | Store is suspended |
| `SERVICE_UNAVAILABLE` | 503 | A dependency is unreachable |
| `INTERNAL_ERROR` | 500 | Unexpected; never carries a stack trace |

`NOT_FOUND` rather than `FORBIDDEN` is returned when a resource exists in
another tenant — the caller learns nothing about what exists elsewhere.

---

## Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/register` | Create a merchant account and tenant |
| POST | `/auth/login` | Admin audience |
| GET | `/auth/me` | Current admin principal + memberships |
| POST | `/auth/switch-tenant` | Change active tenant (membership required) |
| GET | `/auth/check-slug` | Subdomain availability |
| POST | `/auth/customer/register` | Shopper; requires a tenant host |
| POST | `/auth/customer/login` | Shopper |
| GET | `/auth/customer/me` | Current shopper |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke session |
| POST | `/auth/change-password` | Revokes other sessions |

## Storefront (public, tenant resolved from host)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/store` | Store profile, theme, banners, policies |
| GET | `/categories` | Category tree |
| GET | `/brands` | Brands |
| GET | `/products` | List; filter by category, brand, price, sort |
| GET | `/products/featured` | Featured products |
| GET | `/products/popular` | Popular products |
| GET | `/products/search` | Trigram search |
| GET | `/products/:slug` | Product detail with variants and images |
| GET | `/products/:id/related` | Related products |
| GET | `/reviews` | Approved reviews for a product |
| GET | `/coupons/available` | Publicly advertised coupons |

## Cart

Works for guests (`X-Guest-Token`) and signed-in customers.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/cart` | Cart with live pricing and totals |
| POST | `/cart/items` | Add a variant |
| PATCH | `/cart/items/:id` | Change quantity |
| DELETE | `/cart/items/:id` | Remove a line |
| DELETE | `/cart` | Empty the cart |
| POST | `/cart/coupon` | Apply a coupon |
| DELETE | `/cart/coupon` | Remove the coupon |
| POST | `/cart/merge` | Fold a guest cart into the customer's on login |

## Orders (customer)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/orders` | Checkout. Accepts `Idempotency-Key` |
| GET | `/orders` | The caller's orders |
| GET | `/orders/:id` | One order with items and history |
| POST | `/orders/:id/cancel` | Only from PENDING, CONFIRMED or PROCESSING |
| GET | `/orders/:orderNumber/tracking` | Status timeline |

## Customer account

| Method | Path |
| --- | --- |
| GET / PATCH | `/customers/me` |
| GET / POST | `/customers/addresses` |
| PATCH / DELETE | `/customers/addresses/:id` |
| GET / POST | `/customers/wishlist` |
| DELETE | `/customers/wishlist/:productId` |
| POST | `/customers/reviews` |
| GET | `/customers/notifications` |
| POST | `/customers/notifications/:id/read` |
| POST | `/customers/notifications/push-token` |

## Payments

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/payments/verify` | Verify a client-side payment signature |
| POST | `/webhooks/payments/:provider` | Provider webhook; signature-verified over the raw body |
| POST | `/payments/mock/:paymentId/:outcome` | Development only |

## Merchant console

All require an admin token plus a verified membership. Permissions in brackets.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/merchant/dashboard` | `reports.read` |
| GET | `/merchant/tenant` | — |
| GET | `/merchant/tenant/memberships` | — |
| GET | `/merchant/products` | `products.read` |
| GET | `/merchant/products/:id` | `products.read` |
| POST | `/merchant/products` | `products.create` |
| PATCH | `/merchant/products/:id` | `products.update` |
| DELETE | `/merchant/products/:id` | `products.delete` |
| POST | `/merchant/products/:id/publish` | `products.update` |
| GET/POST/PATCH/DELETE | `/merchant/categories[/:id]` | `categories.*` |
| GET/POST/PATCH/DELETE | `/merchant/brands[/:id]` | `brands.*` |
| GET | `/merchant/inventory` | `inventory.read` |
| POST | `/merchant/inventory/adjust` | `inventory.update` |
| POST | `/merchant/inventory/bulk-adjust` | `inventory.update` |
| POST | `/merchant/inventory/threshold` | `inventory.update` |
| GET | `/merchant/inventory/transactions` | `inventory.read` |
| GET | `/merchant/orders` | `orders.read` |
| GET | `/merchant/orders/:id` | `orders.read` |
| POST | `/merchant/orders/:id/status` | `orders.update` |
| PATCH | `/merchant/orders/:id/notes` | `orders.update` |
| GET | `/merchant/customers[/:id]` | `customers.read` |
| PATCH | `/merchant/customers/:id` | `customers.update` |
| GET/POST/PATCH/DELETE | `/merchant/coupons[/:id]` | `coupons.*` |
| GET | `/merchant/reviews` | `reviews.read` |
| POST | `/merchant/reviews/:id/moderate` | `reviews.moderate` |
| GET | `/merchant/store` | `store.manage` |
| PATCH | `/merchant/store` | `store.manage` / `store.design` |
| GET/POST/PATCH/DELETE | `/merchant/staff[/:id]` | `staff.*` |
| GET | `/merchant/reports/sales` | `reports.read` |
| GET | `/merchant/reports/customers` | `reports.read` |
| GET | `/merchant/reports/inventory` | `reports.read` |
| POST | `/merchant/files/upload` | `files.upload` |

## Platform (super admin only)

| Method | Path |
| --- | --- |
| GET | `/platform/overview` |
| GET | `/platform/tenants[/:id]` |
| POST | `/platform/tenants` |
| POST | `/platform/tenants/:id/status` |
| POST | `/platform/tenants/:id/provision` |
| GET | `/platform/tenants/:id/provisioning-jobs` |
| POST | `/platform/tenants/:id/migrate` |
| POST | `/platform/tenants/:id/entitlements` |
| POST | `/platform/tenants/:id/subscription` |
| GET/POST/PATCH/DELETE | `/platform/plans[/:id]` |
| GET | `/platform/audit-logs` |
| GET | `/platform/system/health` |
| GET | `/platform/system/queues` |

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Full check: database, Redis, storage |
| GET | `/health/live` | Liveness — process is up |
| GET | `/health/ready` | Readiness — dependencies reachable |
| GET | `/health/metrics` | Prometheus exposition |

---

Worked examples with real curl commands: [API_EXAMPLES.md](API_EXAMPLES.md).
