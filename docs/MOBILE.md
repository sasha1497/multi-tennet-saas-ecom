# Mobile app

Expo SDK 51 + expo-router, React Native. The customer shopping app — merchants
use the web console.

## Running it

```bash
pnpm --filter @retailos/mobile start
```

Press `i` for the iOS simulator, `a` for Android, or scan the QR code with Expo
Go on a physical device.

For a **physical device**, the app must reach your machine over the LAN:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api/v1
EXPO_PUBLIC_PLATFORM_DOMAIN=localhost
```

`localhost` on a phone means the phone. Use your machine's LAN IP.

## Structure

```
app/
  _layout.tsx                root: providers, theme, store context
  (shop)/
    _layout.tsx              tab bar
    index.tsx                home
    categories.tsx           browse
    search.tsx               search
    bag.tsx                  cart
    account.tsx              profile, orders, addresses
  product/[slug].tsx         product detail, variants, add to bag
  order/[orderNumber].tsx    order detail and tracking
  cart.tsx  checkout.tsx     checkout flow
  discover.tsx               store selection
  scan.tsx                   barcode / QR scan
  login.tsx  register.tsx    auth
src/
  lib/api.ts                 API client wiring
  lib/theme.ts               tenant theme → React Native styles
  lib/store-context.tsx      selected store, persisted
  components/ui.tsx          shared primitives
```

## Choosing a store

This is the one place the mobile app genuinely differs from the web.

A phone has no hostname to offer, so the app cannot resolve a tenant the way a
browser does. Instead it **selects a store explicitly** — `discover.tsx` lists
available shops, or `scan.tsx` reads a QR code the merchant displays in the
shop — and then sends `X-Tenant-Slug` on every request.

That header resolves a public storefront exactly as a hostname would, and grants
exactly as much: nothing. A token still has to match, and merchant endpoints
still require a membership. A merchant token plus an `X-Tenant-Slug` pointing at
someone else's shop is rejected, and the isolation suite tests precisely that.

The selection is persisted, so the app reopens in the same shop.

## Theming

The store's colours arrive with its bootstrap payload and are applied through
`src/lib/theme.ts`, so the app takes on each merchant's identity — the same
runtime-theming idea as the web storefront, expressed as a React Native theme
object rather than CSS custom properties.

## Shared code

The mobile app consumes the same packages as the web apps: `@retailos/types`,
`@retailos/validation`, `@retailos/api-client`, `@retailos/config`. There is no
second implementation of pricing, permissions or validation for mobile to drift
away from.

One constraint this imposes: **no regex lookbehind**. Hermes does not support
it, so shared schemas are written without it — `hostnameSchema` in particular.

## Metro under pnpm

pnpm's isolated `node_modules` layout is not what Metro assumes by default.
`apps/mobile/metro.config.js` carries the working configuration and the
reasoning; the important parts:

```js
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
```

Two things that look helpful and are not:

- **`disableHierarchicalLookup = true`** suits hoisted layouts. pnpm relies on
  per-package `node_modules`, and setting it breaks `@expo/metro-runtime` and
  friends.
- **`unstable_enablePackageExports = true`**, set speculatively, broke
  `react-native` resolution.

`@babel/runtime` is a **direct** dependency of the mobile app — its helpers are
imported from the app's own compiled files, so hoisting cannot be relied on.

## Building

```bash
pnpm --filter @retailos/mobile exec expo export --platform ios
pnpm --filter @retailos/mobile exec expo export --platform android
```

For store builds, use EAS with a `eas.json` profile per environment, pointing
`EXPO_PUBLIC_API_URL` at production.

The iOS export has been verified end to end (a 2.76 MB bundle).

## Not implemented

- No push notification registration flow in the UI, though the API endpoint and
  the `push_tokens` table exist.
- No offline mode or local catalog cache.
- No native payment sheet — checkout uses the same web gateway flow.
- Not submitted to either store; no EAS configuration is included.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
