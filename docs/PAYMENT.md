# Payments

## Provider abstraction

Payments go through an adapter interface
(`apps/api/src/modules/payments/payment-provider.interface.ts`), never directly
to a gateway SDK. Two adapters ship:

- **Razorpay** — UPI, cards, net banking, wallets. The default for the Indian
  market.
- **Mock** — a development provider that signs and verifies with the same
  algorithm shape as the real one, so the *verification path* is exercised
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
  parseWebhook(raw: Buffer, headers: Record<string, string | undefined>): NormalisedPaymentEvent | null;

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

`orders.refund` permission required. A refund calls the provider adapter,
records the result, moves the order to `REFUNDED` and returns reserved or sold
stock to inventory. `DELIVERED → REFUNDED` and `CANCELLED → REFUNDED` are the
only legal paths into it.

## Money

Every amount is an integer in the minor unit (paise). The gateway is given the
same integer, because that is what payment APIs expect — a float here is a
rounding bug that appears in someone's bank statement.

The order records `tax_inclusive` so its totals stay consistent with the
convention in force at the time, even if the store changes the setting later —
see [ADR-010](DECISION_LOG.md#adr-010).

## Configuration

```bash
PAYMENT_PROVIDER=razorpay          # or 'mock' in development
PAYMENT_CURRENCY=INR
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Per-tenant provider configuration lives in `payment_routes` in the master
database, so a merchant can eventually use their own gateway account and receive
settlements directly. Keys there are encrypted like any other credential.

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

- Partial refunds (the model supports the amount; the flow assumes full).
- Saved cards / tokenisation — deliberately out of scope, since it moves the
  system into PCI territory.
- Subscription billing for merchants is modelled (`plans`, `subscriptions`) but
  not wired to a gateway; plan changes are recorded, not charged.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
