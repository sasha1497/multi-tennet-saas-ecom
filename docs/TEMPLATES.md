# Storefront templates

A shop owner can change how their storefront looks without changing anything
about what their shop is. Three hundred products, four thousand orders and every
customer account survive a template switch untouched.

This document explains how that is guaranteed rather than merely intended.

---

## The split

The system has two layers, and the whole design turns on keeping them apart.

```
Tenant
  │
  ├── BUSINESS DATA ─────────────── the shop's actual business
  │     products, variants, prices, stock
  │     categories, brands
  │     customers, accounts, addresses
  │     orders, order items, payments
  │     coupons, inventory ledger
  │
  └── PRESENTATION ──────────────── how the shop looks
        template_id            ← which design
        template_version       ← which version of it
        template_customization ← the merchant's section overrides
        theme / logo / banners  (branding, from store settings)
```

Presentation is **three columns on one row**. Switching a template writes those
three columns and reads nothing else. There is no code path from the switch to a
product, an order, a customer, a payment or an inventory row — which is why the
operation cannot lose data, not because it is careful, but because it never
touches it.

```
Store data ──▶ Template renderer ──▶ Storefront
                      ▲
              active template + customisation
```

Templates **read** store data. They never own it, copy it, adapt it or store it.
`ProductRow` is handed `ProductListItem[]` and renders it; it does not know which
template it is in, and no template has its own copy of a product.

---

## Where the pieces live

| Layer | Location | What it is |
| --- | --- | --- |
| Catalogue | `packages/templates` | Pure data + pure functions. No React, no DB. |
| Storage | `store_settings` (tenant DB) | Three presentation columns. |
| API | `StoreService.updateTemplate` | The only write that changes a store's design. |
| Renderer | `apps/storefront-web/src/templates` | Section and variant components. |
| Console | `apps/merchant-web/src/app/(console)/store` | Design, gallery, builder. |

`@retailos/templates` is deliberately dependency-free so the API, the console and
the storefront can all agree on what a template *is* without depending on each
other.

---

## The templates

Six design languages, not six colour schemes. They differ in type, density,
grid, card shape, product-detail layout and which sections exist at all.

| Id | Name | For | Character |
| --- | --- | --- | --- |
| `urban-luxe` | Urban Luxe | Men's wear, footwear, sports | Full-bleed hero, uppercase display type, square corners, tall 3:4 portrait grid, sticky buy box |
| `silk-editorial` | Silk Editorial | Women's wear, textile, saree, boutique, jewellery | Serif headings, centred rules, airy rhythm, 3-column gallery, stacked product gallery |
| `spec-grid` | Spec Grid | Mobile shop, electronics, computer accessories | Utility header, EMI strip, brand tiles, dense 5-column grid, specification sheet |
| `glow-beauty` | Glow | Cosmetics, beauty and personal care | Soft curves, warm neutrals, routine editorial, rounded cards |
| `daily-cart` | Daily Cart | Grocery, general store, fancy store, stationery | Search-first hero, aisle chips, compact 6-column grid, shortest path to basket |
| `pawsome` | Pawsome | Pet shop, gift shop, kids wear, toys | Pill shapes, bubble categories, playful colour |

`daily-cart` is the fallback: the most neutral of the six, so any catalogue reads
acceptably in it.

### Anatomy

```
TemplateDefinition
  ├── theme     colours, surface, ink, radius, fonts, weight, tracking, density
  ├── layout    header · footer · productCard · productDetail · grid · aspect
  └── sections  ordered list of { id, kind, variant, title, source, removable }
```

A **kind** is a contract — it says which slice of store data a section reads. A
**variant** is how a particular template renders that kind. Two templates can
both show `productRow` and look nothing alike, and a new template that reuses
existing variants needs no component changes at all.

---

## Theming

The storefront's design system already reads from CSS custom properties, so a
template change is a change of *values*, not of components. `templateCssVariables`
resolves the palette, type and rhythm onto `<html>` during the server render —
there is no flash of the wrong design on first paint.

**Who wins.** The template supplies the whole palette; the merchant's branding
overrides it, but only where they actually set something. Every store carries
`defaultStoreTheme` on its settings row whether or not the owner ever opened the
colour picker, so honouring it unconditionally would repaint all six templates
the same blue. A branding value counts as an override only when it differs from
the platform default.

---

## Switching

```
PUT /merchant/store/template   { templateId?, customization? }
```

Send `templateId` to change design, `customization` to change section
visibility / order / headings, or both. Presentation only.

**Customisation is stored unfiltered and sanitised on read.** A merchant who
hides "testimonials", switches to a template that has no such section, and
switches back finds it still hidden. The stored value keeps every preference;
`sanitiseCustomization` filters the *applied* value to what the active template
can honour. (Reading the sanitised view and writing it back would silently
delete preferences the outgoing template happened not to use — the bug this
design exists to prevent, and the one `template-switching.e2e-spec.ts` catches.)

**Versions are pinned.** A store records the version it adopted, so publishing a
new version of a template cannot restyle a live shop. A store pinned to a
version that has since been withdrawn falls *forward* to the newest version of
the same template rather than losing its design.

---

## Preview

Preview is the real storefront, serving the real catalogue, rendered through a
different template:

```
https://kickzone.example.com/?__template=urban-luxe
```

The storefront's `middleware.ts` promotes the parameter to a session cookie so
it survives the navigation that follows, and mirrors it onto a request header so
the first previewed render already honours it. `?__template=off` ends it.

Why it is safe:

- It selects a **design**, never a **store**. The tenant is still resolved from
  the Host by the API, exactly as always.
- Nothing is persisted. The stored template is not read or written by preview;
  adopting a design is a separate, authenticated call.
- Unknown ids are ignored rather than trusted, so the value reaching the
  renderer is always one of ours.
- A ribbon says the page is a preview, because for that moment the page is not
  what a customer would see.

The console frames this URL in `DevicePreview` at genuine device widths (1280 /
834 / 390), scaled to fit rather than resized — so "desktop" shows a real
desktop layout, not a narrow one pretending to be one.

Framing is permitted by `frame-ancestors` in the storefront's CSP, which allows
the storefront itself and this deployment's console, and nothing else.

---

## What is guaranteed, and where it is proved

`apps/api/test/template-switching.e2e-spec.ts` boots the real application against
the real databases:

| Guarantee | Test |
| --- | --- |
| Products, categories, orders, customers, inventory and settings are byte-identical across a switch | `leaves … identical` |
| Orders are not renumbered and ids are not reissued | `does not renumber orders or reissue ids` |
| One store's switch does not touch another's storefront | `does not change another store's storefront` |
| A merchant cannot switch a store they do not belong to | `refuses a merchant switching a store they do not belong to` |
| Preview never changes the stored template | `never changes the stored template` |
| A → B → C → A returns the store to exactly where it started | `returns the store to exactly where it started` |
| A merchant's layout survives a round trip | `remembers a merchant's section layout` |
| An unknown template is rejected rather than stored | `are rejected rather than stored` |

`packages/templates/src/resolve.spec.ts` covers the resolver: version pinning,
recommendations, sanitisation and section ordering.

---

## Adding a template

1. Append a `TemplateDefinition` to `TEMPLATES` in `packages/templates/src/registry.ts`.
2. Reuse existing variants where they fit. Add a new one only when the design
   genuinely needs it — then implement it in the matching
   `apps/storefront-web/src/templates/sections/*` switch.
3. List the business categories it suits in `businessTypes`; that is what drives
   the "Recommended for you" rail.
4. Run `pnpm --filter @retailos/templates test` — the registry has invariants
   (unique ids, at least one non-removable section, every product row has a
   source and a limit).

**Never edit the `sections[].id` of a published template.** Merchants' stored
customisation refers to those ids. To change a template's structure, publish it
as a new `version`.

---

## Adding a section kind

1. Add the kind to `SectionKind` in `packages/templates/src/types.ts`.
2. If it reads data no section reads yet, fetch it in
   `apps/storefront-web/src/templates/data.ts` — gated on the kind being
   present, so templates that do not use it do not pay for the request.
3. Render it in `renderer.tsx`.
4. Give it a label and a help string in the store builder
   (`app/(console)/store/customize/page.tsx`), so a merchant is told what the
   section does in their own terms.

Unknown kinds render nothing rather than throwing: a store pinned to an older
template version must keep working when the catalogue moves on.

---

## The rules

1. **Templates must not own business data.** No products, orders, customers or
   payments inside a template. Templates receive data.
2. **Switching is presentation-level.** If a change would require touching a
   business table, it is not a template change.
3. **Preview is read-only.** Nothing persists until the merchant adopts a design.
4. **Customisation is stored raw, filtered on read.** That is what makes
   switching reversible.
5. **Published section ids are permanent.** Change structure by publishing a new
   version.
