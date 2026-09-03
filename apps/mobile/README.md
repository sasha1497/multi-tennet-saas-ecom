# RetailOS Shop — mobile app

One React Native (Expo) app that can open **any** merchant's store on the
platform. See [`../../docs/MOBILE.md`](../../docs/MOBILE.md) for the full design
notes.

## Running it

The API must already be running (`pnpm docker:up` at the repo root, or
`pnpm --filter @retailos/api dev`).

```bash
pnpm --filter @retailos/mobile dev
```

Then press `i` for the iOS simulator, `a` for an Android emulator, or scan the QR
code with Expo Go on a physical device.

## How the app finds a store

| Entry point | Example |
|---|---|
| Type the store address | `kickzone` |
| Scan the shop's QR code | encodes `https://kickzone.ourdomain.in` |
| Deep link | `retailos://store/kickzone` |
| Universal link | `https://kickzone.ourdomain.in/...` |

All four reduce to a slug, which the API resolves through the same `domains`
table lookup that the web storefront's Host header uses.

## Connecting to a local API

Expo reads the dev server's LAN address and points the API at
`http://<lan-ip>:4000/api/v1`, which is what a physical device can actually
reach — `localhost` on a phone means the phone.

Override it explicitly if needed:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api/v1 pnpm --filter @retailos/mobile dev
```

In production, set `EXPO_PUBLIC_PLATFORM_DOMAIN=ourdomain.in` and the app talks
to `https://<slug>.ourdomain.in/api/v1`, so the tenant travels in the Host header
exactly as it does on the web.

## Where things live

```
app/                    expo-router file-based routes
  _layout.tsx           providers + the discovery/shop switch
  discover.tsx          tenant discovery (type, scan, deep link)
  scan.tsx              QR scanner
  (shop)/               the tab navigator for a chosen store
    index.tsx           home
    categories.tsx      category list
    search.tsx          search + category filter
    bag.tsx             cart
    account.tsx         profile + orders
  product/[slug].tsx    product detail with variant selection
  checkout.tsx          address, payment method, place order
  order/[orderNumber]   order detail + delivery timeline
src/
  lib/api.ts            API client, keychain-backed token store
  lib/store-context.tsx tenant/session/cart state
  lib/theme.ts          design tokens mirroring the web system
  components/ui.tsx     shared primitives
```

Business logic lives in the API. This app shares `@retailos/api-client`,
`@retailos/types` and `@retailos/config` with both web apps, so there is exactly
one definition of every endpoint, type and money formatter.
