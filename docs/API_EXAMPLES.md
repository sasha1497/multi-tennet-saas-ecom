# API examples

Every command below runs against the seeded development stack. They are the same
calls the end-to-end smoke suite makes, so they work as written.

```bash
API=http://localhost:4000/api/v1      # direct to the API
# API=http://localhost/api/v1         # through nginx (pnpm docker:up)
```

Tenants are addressed by `Host`, exactly as nginx passes them through.

---

## 1. Storefront bootstrap

```bash
curl -s -H 'Host: kickzone.localhost' $API/store | jq '.data.store.storeName, .data.store.theme'
```

```json
"KickZone"
{
  "primaryColor": "#1f47e0",
  "accentColor": "#f97316",
  "radius": "md",
  "fontFamily": "Inter",
  "colorMode": "light"
}
```

Each hostname resolves to a different shop:

```bash
for t in kickzone abcstore kumarstore; do
  curl -s -H "Host: $t.localhost" $API/store | jq -r '.data.store.storeName'
done
# KickZone
# ABC Store
# Kumar Mobile Store
```

An unknown subdomain resolves to nothing:

```bash
curl -s -H 'Host: nosuchstore.localhost' $API/store | jq -r '.error.code'
# TENANT_NOT_FOUND
```

## 2. Browse the catalog

```bash
curl -s -H 'Host: kickzone.localhost' "$API/products?limit=5" \
  | jq -r '.data[] | "\(.name) — ₹\(.price/100)"'

curl -s -H 'Host: kickzone.localhost' "$API/products/search?q=snekaer" \
  | jq -r '.data[].name'          # trigram search tolerates the typo

curl -s -H 'Host: kickzone.localhost' $API/categories | jq -r '.data[].name'
```

A product slug from one tenant does not exist on another:

```bash
SLUG=$(curl -s -H 'Host: kickzone.localhost' "$API/products?limit=1" | jq -r '.data[0].slug')
curl -s -H 'Host: kumarstore.localhost' "$API/products/$SLUG" | jq -r '.error.code'
# NOT_FOUND
```

## 3. Sign in as a shopper

```bash
CTOK=$(curl -s -H 'Host: kickzone.localhost' -X POST $API/auth/customer/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"priya@example.com","password":"Password@123"}' \
  | jq -r '.data.tokens.accessToken')

curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  $API/auth/customer/me | jq '.data.customer.email'
# "priya@example.com"
```

`identifier` accepts an email or a phone number.

## 4. Cart

```bash
# Pick an in-stock variant
VARIANT=$(curl -s -H 'Host: kickzone.localhost' "$API/products/$SLUG" \
  | jq -r '[.data.variants[] | select(.stock.available > 0)][0].id')

curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/cart/items -H 'Content-Type: application/json' \
  -d "{\"variantId\":\"$VARIANT\",\"quantity\":2}" \
  | jq '.data.totals'
```

```json
{
  "subtotal": 519800,
  "discount": 0,
  "tax": 79292,
  "shipping": 0,
  "total": 519800,
  "itemCount": 2
}
```

All amounts are paise. The store prices tax-inclusive, so `tax` is the GST
*contained in* the subtotal, not an addition to it — which is why `total` equals
`subtotal` here.

Apply a coupon:

```bash
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/cart/coupon -H 'Content-Type: application/json' \
  -d '{"code":"WELCOME10"}' | jq '.data.totals'
```

### Guest cart

With no token, the API issues a guest token in the `X-Guest-Token` response
header. Send it back on subsequent calls, then merge on login:

```bash
GT=$(curl -si -H 'Host: kickzone.localhost' -X POST $API/cart/items \
  -H 'Content-Type: application/json' \
  -d "{\"variantId\":\"$VARIANT\",\"quantity\":1}" \
  | awk -F': ' '/^x-guest-token/{print $2}' | tr -d '\r')

curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/cart/merge -H "X-Guest-Token: $GT" | jq '.data.items | length'
```

## 5. Checkout — cash on delivery

```bash
ADDR=$(curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  $API/addresses | jq -r '.data[0].id')

IDEM="demo-$(date +%s)"

curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/orders -H 'Content-Type: application/json' \
  -d "{\"shippingAddressId\":\"$ADDR\",\"paymentMethod\":\"COD\",\"idempotencyKey\":\"$IDEM\"}" \
  | jq '.data.order | {orderNumber, status, totalAmount}'
```

```json
{ "orderNumber": "KZ-20260905-0007", "status": "PENDING", "totalAmount": 519800 }
```

Replaying the same idempotency key returns the **same** order rather than
placing a second one:

```bash
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/orders -H 'Content-Type: application/json' \
  -d "{\"shippingAddressId\":\"$ADDR\",\"paymentMethod\":\"COD\",\"idempotencyKey\":\"$IDEM\"}" \
  | jq -r '.data.order.orderNumber'      # identical to the first
```

## 6. Checkout — online payment

```bash
PAY=$(curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/orders -H 'Content-Type: application/json' \
  -d "{\"shippingAddressId\":\"$ADDR\",\"paymentMethod\":\"UPI\",\"idempotencyKey\":\"upi-$(date +%s)\"}")

PAYID=$(echo "$PAY" | jq -r '.data.payment.paymentId')
```

A forged signature is rejected:

```bash
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/payments/verify -H 'Content-Type: application/json' \
  -d "{\"paymentId\":\"$PAYID\",\"providerOrderId\":\"forged\",\"providerPaymentId\":\"forged\",\"signature\":\"deadbeef\"}" \
  | jq -r '.error.code'
# PAYMENT_SIGNATURE_INVALID
```

In development, the mock provider can complete the payment with a real
signature:

```bash
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/payments/mock/$PAYID/success | jq -r '.data.status'
# PAID
```

The order confirms automatically:

```bash
OID=$(echo "$PAY" | jq -r '.data.order.id')
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  $API/orders/$OID | jq '{status, paymentStatus}'
# { "status": "CONFIRMED", "paymentStatus": "PAID" }
```

## 7. Track an order

```bash
curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  $API/orders/KZ-20260905-0007/tracking | jq '.data.timeline'
```

## 8. Merchant console

The console has no tenant hostname — the tenant comes from your membership.

```bash
MTOK=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@kickzone.dev","password":"Password@123"}' \
  | jq -r '.data.tokens.accessToken')

curl -s $API/merchant/dashboard -H "Authorization: Bearer $MTOK" \
  | jq '.data | {todayRevenue, openOrders, lowStockCount}'
```

Create a product:

```bash
curl -s -X POST $API/merchant/products -H "Authorization: Bearer $MTOK" \
  -H 'Content-Type: application/json' -d '{
    "name": "TrailRunner Pro",
    "description": "Cushioned trail shoe with a grippy outsole.",
    "status": "PUBLISHED",
    "taxRateBps": 1800,
    "variants": [
      { "name": "UK 8",  "sku": "TRP-8",  "price": 449900, "mrp": 599900, "stock": 12 },
      { "name": "UK 9",  "sku": "TRP-9",  "price": 449900, "mrp": 599900, "stock": 8 }
    ]
  }' | jq '.data | {id, slug, status}'
```

Adjust stock (optimistic locking — send the version you read):

```bash
curl -s -X POST $API/merchant/inventory/adjust -H "Authorization: Bearer $MTOK" \
  -H 'Content-Type: application/json' \
  -d '{"variantId":"<id>","quantity":25,"reason":"RESTOCK","version":3}' \
  | jq '.data | {quantity, reserved, version}'
```

A stale version loses cleanly:

```json
{ "success": false, "error": { "code": "CONCURRENT_MODIFICATION", "message": "The operation conflicted with another change. Please retry." } }
```

Progress an order:

```bash
curl -s -X POST $API/merchant/orders/<id>/status -H "Authorization: Bearer $MTOK" \
  -H 'Content-Type: application/json' -d '{"status":"CONFIRMED"}'
```

An illegal jump is refused:

```bash
curl -s -X POST $API/merchant/orders/<id>/status -H "Authorization: Bearer $MTOK" \
  -H 'Content-Type: application/json' -d '{"status":"DELIVERED"}' | jq -r '.error.code'
# INVALID_STATE_TRANSITION
```

### Owners with several stores

```bash
curl -s $API/merchant/tenant/memberships -H "Authorization: Bearer $MTOK" \
  | jq -r '.data[] | "\(.tenant.slug) — \(.role)"'

curl -s $API/merchant/products -H "Authorization: Bearer $MTOK" \
  -H "X-Tenant-Id: <one of your tenant ids>"
```

Pointing that header at a store you do not belong to:

```json
{ "success": false, "error": { "code": "TENANT_MEMBERSHIP_REQUIRED", "message": "You do not have access to this store" } }
```

## 9. Platform admin

```bash
STOK=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@retailos.dev","password":"SuperAdmin@123"}' \
  | jq -r '.data.tokens.accessToken')

curl -s $API/platform/overview   -H "Authorization: Bearer $STOK" | jq '.data'
curl -s $API/platform/tenants    -H "Authorization: Bearer $STOK" | jq -r '.data[] | "\(.slug) \(.status)"'
curl -s $API/platform/system/queues -H "Authorization: Bearer $STOK" | jq '.data'
```

Create and provision a tenant:

```bash
TID=$(curl -s -X POST $API/platform/tenants -H "Authorization: Bearer $STOK" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sharma Textiles","slug":"sharma","ownerEmail":"owner@sharma.dev","ownerName":"R Sharma","planCode":"starter"}' \
  | jq -r '.data.id')

curl -s $API/platform/tenants/$TID/provisioning-jobs -H "Authorization: Bearer $STOK" \
  | jq '.data[0] | {status, completedSteps, error}'
```

Once the job reaches `ACTIVATE`, the storefront is live at
`sharma.localhost`.

## 10. Cross-tenant attempts (all rejected)

```bash
# A KickZone shopper token aimed at another store
curl -s -H 'Host: kumarstore.localhost' -H "Authorization: Bearer $CTOK" \
  $API/orders | jq -r '.error.code'
# FORBIDDEN

# A tenantId smuggled into the body — ignored, the order is created in YOUR store
curl -s -X POST $API/merchant/categories -H "Authorization: Bearer $MTOK" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Injected","tenantId":"<someone else id>"}' | jq -r '.data.name'

# A shopper token on merchant routes
curl -s $API/merchant/orders -H "Authorization: Bearer $CTOK" | jq -r '.error.code'
# FORBIDDEN

# A merchant token on platform routes
curl -s $API/platform/tenants -H "Authorization: Bearer $MTOK" | jq -r '.error.code'
# FORBIDDEN
```

## Health

```bash
curl -s $API/health | jq '.data'
curl -s $API/health/live
curl -s $API/health/metrics | head -20
```
