# Payments

## Who gets paid

Two money flows that never mix:

| Flow | Payer → payee | Where | Gateway account |
| --- | --- | --- | --- |
| Store order payment | shopper → **store** | `modules/payments`, tenant `payments` table | the **store's own** Razorpay account |
| Subscription | store → retailos | `modules/billing`, master `subscription_invoices` | retailos's account |

A customer's payment is created on the store's Razorpay account, so Razorpay
settles it to the store's bank. retailos never collects it and takes no share.
There is no platform commission: Razorpay Partner OAuth has no mechanism for
one, and inventing a deduction would be fake settlement. retailos earns from
the subscription.

## Connecting a store: Razorpay Partner OAuth

The default. The merchant clicks **Settings → Payments → Connect Razorpay**,
approves retailos on Razorpay's own page, and is sent back to the console.
Endpoints as documented for Technology Partners
([integration steps](https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/integration-steps/)):

```
GET  auth.razorpay.com/authorize   client_id, response_type=code, redirect_uri, scope=read_write, state
POST auth.razorpay.com/token       authorization_code | refresh_token
POST auth.razorpay.com/revoke
```

- `state` is single-use, held in Redis for 10 minutes, and bound to the tenant
  **and** the user who started it. The callback takes the tenant from it, so a
  code cannot be attached to another store.
- We store only the merchant's `razorpay_account_id`, the `public_token`
  (Checkout key) and the access/refresh tokens, encrypted with the same
  AES-256-GCM cipher as every credential. **No merchant API secret.**
- Orders and refunds are created with `Authorization: Bearer <store token>`.
  Access tokens (90 days) are refreshed 7 days early; a refused refresh moves
  the store to `ACTION_REQUIRED` and checkout simply stops offering online
  payment.
- One Razorpay account can back one store.
- `account.app.authorization_revoked` (or Disconnect in the console) stops
  online payment at once. Orders and payments already taken are untouched.

Status shown to the merchant: `NOT_CONNECTED`, `CONNECTED`, `ACTION_REQUIRED`,
`REVOKED`.

### Manual keys (fallback)

Stores that already pasted their own key id/secret keep working
(`connection_type = 'keys'`). New stores should connect via OAuth. A store
connected via OAuth cannot have keys pasted over it without disconnecting.

### The platform fallback is development-only, and never after setup

With no configuration of its own, a store falls back to the platform gateway
(the mock, locally). That fallback is refused in production, and refused
everywhere for a store that has **ever** configured its own gateway — a store
that disconnected must not have its customers pay retailos.

## Provider abstraction

Payments go through an adapter interface
(`apps/api/src/modules/payments/payment-provider.interface.ts`), never directly
to a gateway SDK. Two adapters ship:

- **Razorpay** — UPI, cards, net banking, wallets. The default for the Indian
  market.
- **Mock** — a development provider that signs and verifies with the same
  algorithm shape as the real one, so the _verification path_ is exercised
  locally rather than stubbed out.

Cash on delivery is handled as a payment method rather than a provider: no
gateway is involved, the order is created immediately, and payment is recorded
at delivery.

```ts
interface PaymentProviderAdapter {
  readonly name: string;
  readonly supportedMethods: readonly PaymentMethod[];

  createIntent(params: CreateIntentParams): Promise<ProviderIntent>;

  /** Constant-time; fails closed on malformed input. */
  verifySignature(params: VerifySignatureParams): boolean;

  /** Receives the RAW body — signatures are over exact bytes. */
  parseWebhook(
    raw: Buffer,
    headers: Record<string, string | undefined>,
  ): NormalisedPaymentEvent | null;

  refund(params: RefundParams): Promise<ProviderRefund>;
}
```

Adding a provider (Stripe, PhonePe, Cashfree) means implementing this interface
and registering it. No order, cart or checkout code changes.

## Checkout flow

```
POST /orders
   │
   ├─ TRANSACTION ──────────────────────────────────────────┐
   │    re-validate every line against live prices & stock   │
   │    reserve stock (conditional UPDATE)                   │
   │    allocate the order number                            │
   │    snapshot line items                                  │
   │    redeem the coupon                                    │
   │    create the payment record (PENDING)                  │
   │    clear the cart                                       │
   └──────────────────────────── COMMIT ─────────────────────┘
   │
   ├─ COD  → order PENDING, done
   │
   └─ online → createIntent() on the gateway   ← OUTSIDE the transaction
                    │
                    ▼
        client completes payment
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  POST /payments/verify     provider webhook
   (signature check)        (signature over raw body)
        └───────────┬────────────┘
                    ▼
          payment PAID → order CONFIRMED
```

**The gateway call is deliberately outside the transaction.** A provider can
take seconds or hang. Holding row locks on inventory for that long would
serialise every checkout in the store behind the slowest gateway call.

**Prices are re-validated inside the transaction**, never trusted from the cart
payload. A client that edits the price in a request body changes nothing.

## Signature verification

This is the check that stops a shopper from marking their own order paid.

- Checkout callback: HMAC-SHA256 of `order_id|payment_id`, keyed by the store's
  key secret — or, for an OAuth store, by the partner app's `client_secret`, as
  Razorpay documents for OAuth partners.
- Then, independently, the payment is **read back from Razorpay** as the store:
  it must exist on that account, belong to the order we created, match the
  amount and currency, and be `captured`. An `authorized` payment is recorded
  as such and confirmed by the `payment.captured` webhook.

- Comparison is constant-time.
- Malformed input fails closed — a missing or truncated signature is a
  rejection, never a pass.
- A forged signature returns `PAYMENT_SIGNATURE_INVALID`, and the smoke suite
  asserts exactly that.

## Webhooks

`POST /webhooks/payments/:provider`

- The app is bootstrapped with `rawBody: true` because signatures are computed
  over the exact bytes received; re-serialising parsed JSON produces a different
  string and every verification would fail.
- Events are deduplicated by provider event id in `webhook_events` (master
  database), so a redelivery cannot double-credit an order.
- Unverified webhooks are rejected and logged, not processed.
- Handling is idempotent: applying a `payment.captured` event twice leaves the
  order in the same state.
- Payment events are routed by Razorpay order id; refund events carry only the
  payment id, so `payment_routes.provider_payment_id` is recorded at capture.
- OAuth stores share one app-level webhook secret
  (`RAZORPAY_OAUTH_WEBHOOK_SECRET`), so the payload's `account_id` must equal
  the account the order was created on, or the event is discarded.
- Handled: `payment.captured`, `order.paid`, `payment.failed`,
  `refund.processed`, `refund.failed`, `account.app.authorization_revoked`.

Webhooks are the authority, not the client callback. A customer who closes the
tab after paying still gets a confirmed order, because the webhook arrives
independently.

## Idempotency

Checkout accepts an `Idempotency-Key`. A repeat with the same key returns the
**original order** rather than placing a second one — a double-tapped Pay button
on a slow connection is the single most common way to create duplicate orders,
and it must be impossible rather than unlikely.

```bash
curl -X POST $API/orders -H "Idempotency-Key: $KEY" ...   # creates
curl -X POST $API/orders -H "Idempotency-Key: $KEY" ...   # returns the same order
```

## Payment states

```
PENDING ──▶ PAID ──▶ REFUNDED
   │
   ├──▶ FAILED
   └──▶ EXPIRED       (reservation released by the maintenance worker)
```

An order whose payment never completes does not hold stock forever: the
maintenance worker releases stale reservations, returning the units to
available.

## Refunds

`POST /merchant/orders/:id/refund { amount?, reason }`, `orders.refund`
permission. Full or partial.

1. A `payment_refunds` row is written PENDING *before* Razorpay is called, with
   an idempotency key Razorpay honours.
2. The refund is created on the store's account; the row records Razorpay's
   refund id.
3. `refund.processed` / `refund.failed` webhooks settle the row; the payment's
   refunded total is recomputed from the rows, so a failed refund is not
   counted. Refunds issued from the Razorpay dashboard are recorded too.
4. A full refund moves the order to `REFUNDED` (and restocks) where the order's
   lifecycle allows it (`DELIVERED`/`CANCELLED → REFUNDED`).

Marking a paid online order `REFUNDED` through the status endpoint is refused:
it would record a refund the customer never received.

## Money

Every amount is an integer in the minor unit (paise). The gateway is given the
same integer, because that is what payment APIs expect — a float here is a
rounding bug that appears in someone's bank statement.

The order records `tax_inclusive` so its totals stay consistent with the
convention in force at the time, even if the store changes the setting later —
see [ADR-010](DECISION_LOG.md#adr-010).

## Configuration

```bash
PAYMENT_PROVIDER=mock                  # platform fallback; development only
PAYMENT_CURRENCY=INR
RAZORPAY_KEY_ID=...                    # platform fallback keys (dev only)
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# Razorpay Partner OAuth (retailos as a Technology Partner)
RAZORPAY_OAUTH_CLIENT_ID=...
RAZORPAY_OAUTH_CLIENT_SECRET=...
RAZORPAY_OAUTH_REDIRECT_URI=https://console.example.com/settings/payments/razorpay/callback
RAZORPAY_OAUTH_WEBHOOK_SECRET=...      # secret of the webhook on the OAuth app
RAZORPAY_OAUTH_MODE=test               # test | live
```

Point the OAuth app's webhook (and any manual-key store's webhook) at
`POST /api/v1/webhooks/payments/razorpay`. Secrets live in the environment
only, never in Git; per-store tokens and keys are encrypted in
`tenant_payment_configs`.

## Testing locally

```bash
PAY=$(curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  -X POST $API/orders -H 'Content-Type: application/json' \
  -d "{\"shippingAddressId\":\"$ADDR\",\"paymentMethod\":\"UPI\",\"idempotencyKey\":\"t-$(date +%s)\"}")

PAYID=$(echo "$PAY" | jq -r '.data.payment.paymentId')

# Forged signature — rejected
curl -s -X POST $API/payments/verify -H 'Content-Type: application/json' \
  -d "{\"paymentId\":\"$PAYID\",\"signature\":\"deadbeef\"}" | jq -r '.error.code'
# PAYMENT_SIGNATURE_INVALID

# Complete it properly
curl -s -X POST $API/payments/mock/$PAYID/success | jq -r '.data.status'
# PAID
```

## What is not implemented

- A platform commission on store payments (not offered by Partner OAuth; see
  "Who gets paid").
- "Pay again" for a pending order after the Checkout window was closed.
- Saved cards / tokenisation — deliberately out of scope, since it moves the
  system into PCI territory.
- Subscription billing for merchants is modelled (`plans`, `subscriptions`) but
  not wired to a gateway; plan changes are recorded, not charged.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
