# Notifications

Three channels — email, SMS, push — behind one service, dispatched from a
worker so a slow SMTP server never delays a checkout response.

## Flow

```
service (e.g. orders)
   │  enqueue
   ▼
BullMQ notifications queue
   │
   ▼
worker → render template → deliver on each channel → record in `notifications`
                                                        (the tenant's database)
```

Delivery failures are retried with backoff (`QUEUE_JOB_ATTEMPTS`,
`QUEUE_JOB_BACKOFF_MS`) and recorded with their error, so a merchant can see
that an email bounced rather than wondering whether it was ever sent.

## Templates

Defined in `apps/api/src/modules/notifications/notification-templates.ts`:

| Template | Trigger | To |
| --- | --- | --- |
| `order.placed` | Checkout completes | Customer |
| `order.confirmed` | Payment received | Customer |
| `order.shipped` | Status → SHIPPED | Customer |
| `order.out_for_delivery` | Status → OUT_FOR_DELIVERY | Customer |
| `order.delivered` | Status → DELIVERED | Customer |
| `order.cancelled` | Order cancelled | Customer |
| `payment.received` | Payment captured | Customer |
| `payment.failed` | Payment failed | Customer |
| `inventory.low_stock` | Stock below threshold | Merchant |
| `merchant.new_order` | New order placed | Merchant |
| `customer.welcome` | Customer registers | Customer |
| `tenant.ready` | Provisioning completes | Merchant |
| `staff.invite` | Staff member invited | Staff |

They are plain functions rather than a templating engine: there are a dozen
messages, they need no logic beyond interpolation, and this way the whole
catalogue is greppable and unit-testable without touching the filesystem.

Each template renders four forms — `subject`, `html`, `text`, and `short` for
SMS and push, which have hard length limits — plus an `actionUrl`.

**Every interpolated value is HTML-escaped.** A product name is
merchant-supplied text and it ends up in an email a customer opens; escaping it
is not optional.

## Tenant branding

Messages carry the merchant's identity, not the platform's: the store name in
the subject and heading, the store's colours in the HTML, and links back to that
tenant's storefront URL. A customer of KickZone receives an email from KickZone.

## Channels and drivers

| Channel | Drivers | Config |
| --- | --- | --- |
| Email | `smtp`, `log` | `MAIL_DRIVER`, `SMTP_*`, `MAIL_FROM` |
| SMS | provider, `log` | `SMS_DRIVER`, `SMS_API_KEY`, `SMS_SENDER_ID` |
| Push | `fcm`, `log` | `PUSH_DRIVER`, `FCM_*` |

**Every channel has a `log` driver**, and that is deliberate: the entire flow —
templating, escaping, persistence, retry, the notification row the customer sees
in their account — is exercised in development without an account with any
provider. Nothing is stubbed except the final network call.

In development, `MAIL_DRIVER=smtp` pointed at Mailpit (http://localhost:8025) is
better still: real SMTP, real rendering, nothing leaves the machine.

## In-app notifications

Every dispatch also writes a row to the tenant's `notifications` table, surfaced
at:

```
GET  /customers/notifications
POST /customers/notifications/:id/read
```

This is the channel that always works — no deliverability, no carrier, no
permissions prompt.

## Push tokens

```
POST /customers/notifications/push-token
```

Tokens are stored per customer in the tenant's `push_tokens` table. Tokens
rejected by the provider as unregistered are removed, so a stale token does not
generate failures forever.

## Merchant alerts

Low-stock alerts and new-order notifications go to the merchant. Low stock fires
when a variant crosses the threshold set from the inventory screen — on the
*transition*, not on every subsequent read, or a merchant with one slow-moving
SKU would receive an alert on every order.

## Configuration

```bash
MAIL_DRIVER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025           # Mailpit in development
MAIL_FROM="RetailOS <no-reply@ourdomain.in>"

SMS_DRIVER=log
PUSH_DRIVER=log

QUEUE_JOB_ATTEMPTS=3
QUEUE_JOB_BACKOFF_MS=5000
WORKER_CONCURRENCY=5
```

## What is not implemented

- No per-customer notification preferences or unsubscribe handling. Transactional
  messages only, which is why that is survivable — but it must exist before any
  marketing send.
- No WhatsApp Business integration, which matters commercially in this market;
  the store settings already carry a WhatsApp number.
- No digest or batching: each event sends its own message.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
