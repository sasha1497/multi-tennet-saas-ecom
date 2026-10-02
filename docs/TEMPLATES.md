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

| Layer     | Location                                    | What it is                                    |
| --------- | ------------------------------------------- | --------------------------------------------- |
| Catalogue | `packages/templates`                        | Pure data + pure functions. No React, no DB.  |
| Storage   | `store_settings` (tenant DB)                | Three presentation columns.                   |
| API       | `StoreService.updateTemplate`               | The only write that changes a store's design. |
| Renderer  | `apps/storefront-web/src/templates`         | Section and variant components.               |
| Console   | `apps/merchant-web/src/app/(console)/store` | Design, gallery, builder.                     |

`@retailos/templates` is deliberately dependency-free so the API, the console and
the storefront can all agree on what a template _is_ without depending on each
other.

---

## The templates

Fourteen design languages in three families — six standard, six premium and
the 3D family — not fourteen colour schemes. They differ in header
arrangement, type, density, grid, card shape, product-detail layout, which
sections exist at all, and how — or whether — the page moves as you scroll.

### Standard

The six a merchant can pick up and use today. Light, pointer-only motion: a
hover state, no scroll observers, no parallax. A shop that wants to be quick
should be quick.

| Id               | Name           | For                                                   | Character                                                                                                                             |
| ---------------- | -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `urban-luxe`     | Urban Luxe     | Men's wear, footwear, sports                          | Full-bleed hero, uppercase display type, square corners, magazine blocks that break the grid, tall 3:4 portrait cards, sticky buy box |
| `spec-grid`      | Spec Grid      | Mobile shop, electronics, computer accessories        | Utility header, EMI strip, brand tiles, comparison rail, dense 5-column grid, specification sheet                                     |
| `glow-beauty`    | Glow           | Cosmetics, beauty and personal care                   | Soft curved opening, warm neutrals, benefit pills, routine editorial, rounded cards                                                   |
| `pawsome`        | Pawsome        | Pet shop, pet supplies, aquarium, veterinary          | Paw-print field, browse-by-companion cards, vet-and-ingredients care strip, treat-shaped badges, pill shapes                          |
| `daily-cart`     | Daily Cart     | Grocery, supermarket, general store, daily essentials | Aisle mega-strip above a search-dominant bar, delivery promise, deal rails, 6-across shelf grid with the price and basket in reach    |
| `silk-editorial` | Silk Editorial | Jewellery, saree, textile, boutique, luxury           | Almost no interface: wordmark, a typographic index of collections, captioned photographs instead of cards, serif at display size      |

`daily-cart` is the fallback: the most neutral of them, so any catalogue reads
acceptably in it.

### Premium

Six designs built around a structural idea the standard tier does not have.
**Not the six above with animation switched on** — different layouts, different
sections, different chrome. They happen to render the same business data
through the same components, which is the entire point of the split.

| Id               | Name           | For                             | The idea                                                                                                                                                    |
| ---------------- | -------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atelier-noir`   | Atelier Noir   | Fashion labels, boutiques       | A full-height film still whose headline unmasks word by word, then the collection told in asymmetric chapters. Cards cross-fade to their second photograph. |
| `lumen-tech`     | Lumen          | Flagship electronics, gadgets   | A dark backlit showcase. Feature panels arrive as you reach them; navigation appears only once you have started reading.                                    |
| `companion-club` | Companion Club | Pet shops                       | Playful motion held to a premium standard. Companion cards that lift, a drifting paw-print field, product rows that arrive in sequence.                     |
| `maison`         | Maison         | Jewellery, watches, accessories | The quietest thing in the catalogue. One held image, type at display size, slow transitions, almost no interface.                                           |
| `lookbook`       | Lookbook       | Fashion labels, boutiques, luxury | Print, not film. A masthead instead of a navigation bar, numbered chapters, products as captioned plates stepping down the page, campaign imagery in pairs. |
| `nova`           | Nova           | General retail, lifestyle, sports | The loud one. A bento-grid opening where headline, campaign and call to action share one composition; mixed-size category tiles; a spotlight product grid. |

`lookbook` and `nova` are deliberately built _against_ the four above them.
Lookbook sits between Atelier Noir and Maison and is neither: where Atelier Noir
is a film — full-height stills, cross-fades, everything in motion — and Maison is
a held breath — centred, symmetrical, almost no interface — Lookbook is a printed
spread: asymmetric, gridded, hairline-ruled, nothing centred and nothing
floating. Nova is the only template built on a bento grid, and the only premium
design that is bright and chunky rather than dark and reverent.

A store **never starts** on a premium template. Provisioning picks the highest
standard match for the business category; premium is a choice made in the
gallery. A cinematic opening is the wrong first impression for a store that has
not uploaded a photograph yet.

### 3D

| Id      | Name  | For                                     | The idea                                                                                                                       |
| ------- | ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `orbit` | Orbit | Footwear, streetwear, sport             | The store's own product photos on a ring beneath the headline. Drag to spin, tap to open. Dark, kinetic.                       |
| `prism` | Prism | Jewellery, cosmetics, fine accessories  | Product plates suspended in soft light; the arrangement leans towards the pointer and a highlight follows it. Pale and quiet. |

Both use the `turntable` product page: the product's photographs on a plate the
shopper drags to turn.

**3D is a layer over a finished 2D design, never a replacement for one.** Every
3D variant server-renders a complete 2D composition (a fanned arc, a still
constellation, the ordinary product image). `templates/three/use-three-scene.ts`
upgrades it to WebGL only when *all* of these hold:

- the store is entitled to the 3D family (`templates_3d`), or the merchant is previewing
- a WebGL context can be created
- no `prefers-reduced-motion`, no Save-Data, no 2G connection
- not a phone-width screen; `deviceMemory` ≥ 4 and ≥ 4 cores where reported
- the island has scrolled near the viewport and the main thread is idle

three.js is then fetched by dynamic import — its own chunk, never downloaded by
a 2D visitor. Scenes are built from the merchant's photographs (no models, no
stock assets), cap the pixel ratio at 2 and textures at 1024px, pause off-screen
and in hidden tabs, and dispose every GPU resource on unmount. Any failure —
a blocked texture, a lost context — leaves the 2D composition in place.

## Families and entitlement

Access is granted **per family, never per template**:

| Family   | Feature key          | First plan |
| -------- | -------------------- | ---------- |
| standard | `templates_standard` | Starter    |
| premium  | `templates_premium`  | Growth     |
| 3d       | `templates_3d`       | Pro        |

A template added to a family reaches every entitled store at once. The mapping
lives in `@retailos/templates` (`entitlement.ts`); the rule is enforced by
`TemplateCatalogService.assertCanActivate`, called from
`StoreService.updateTemplate` — the console only draws the locks.

**Only activation is gated.** A store already on a template its plan no longer
includes — after a downgrade, a lapsed payment, or the template being withdrawn
— keeps rendering it and can keep editing its sections. Nothing is reset. The
gallery tells the merchant and offers an upgrade; a 3D template on a store
without `templates_3d` simply renders its 2D composition.

**Publishing.** A super admin can withdraw a template (`PATCH
/platform/templates/:id`, stored in `template_publications`). It disappears from
galleries and cannot be newly adopted; stores already on it are untouched.

### Motion

Premium templates declare a motion personality — reveal style, stagger,
parallax, hover, sticky navigation — and the storefront implements it once, in
`apps/storefront-web/src/templates/motion.tsx`, under four rules:

1. **Only `transform`, `opacity` and `clip-path` animate.** All composited;
   none trigger layout or paint.
2. **One shared `IntersectionObserver`**, not one per element, and elements
   unsubscribe as soon as they have appeared.
3. **No scroll handlers.** Parallax reads scroll position inside
   `requestAnimationFrame`, and only while the element is on screen.
4. **`prefers-reduced-motion` is honoured at the source.** Not a shorter
   animation — no animation. The observer is never attached and the stylesheet
   renders everything in its final state.

Server-rendered markup is always the _finished_ state; the starting state is
applied by CSS only once the client has confirmed motion is wanted. A page with
JavaScript disabled shows its content rather than a column of invisible
sections.

Standard templates emit no reveal attributes at all, so `Reveal` collapses to
its children and they pay nothing for a feature they do not use.

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
template change is a change of _values_, not of components. `templateCssVariables`
resolves the palette, type and rhythm onto `<html>` during the server render —
there is no flash of the wrong design on first paint.

**Who wins.** The template supplies the whole palette; the merchant's branding
overrides it, but only where they actually set something. Every store carries
`defaultStoreTheme` on its settings row whether or not the owner ever opened the
colour picker, so honouring it unconditionally would repaint every template the
same blue. A branding value counts as an override only when it differs from the
platform default.

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
`sanitiseCustomization` filters the _applied_ value to what the active template
can honour. (Reading the sanitised view and writing it back would silently
delete preferences the outgoing template happened not to use — the bug this
design exists to prevent, and the one `template-switching.e2e-spec.ts` catches.)

**Versions are pinned.** A store records the version it adopted, so publishing a
new version of a template cannot restyle a live shop. A store pinned to a
version that has since been withdrawn falls _forward_ to the newest version of
the same template rather than losing its design.

### A switch is visible on the very next request

The write invalidates the API's Redis entry for the store, and the storefront
**never caches the bootstrap read**. Both halves are required, and the second
one is easy to get wrong.

`apps/storefront-web/src/lib/server-api.ts` used to apply
`next: { revalidate: 60 }` to every server fetch. That is right for the
catalogue — a burst of visitors should not become a burst of API calls — but the
bootstrap also carries `templateId`, `templateVersion` and the merchant's
customisation. The effect was that a merchant switched design, saw their old
storefront, switched again, saw the old one again, and concluded that switching
was broken or that two templates looked identical. It was not one stale request
either: every concurrent visitor in the window got the stale design.

So `loadStorefront` is `cache: 'no-store'`, wrapped in React's `cache()` to keep
it at exactly one API call per render — `generateMetadata`, the layout and the
page all share it. Catalogue reads keep the 60-second policy via
`serverApi({ revalidate })`.

**If you add a server read that carries presentation state, it must not be
cached.** Everything else should be.

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

### Previewing an unsaved layout

The store builder stages section changes locally and applies them on save, so a
half-finished rearrangement is never live to customers. The draft still has to
be _visible_, though, and it travels the same way the template does:

```
https://kickzone.example.com/?__template=off&__sections=<base64url>
```

`@retailos/templates/preview` encodes and — more importantly — **validates** it.
The value is decoded, then checked field by field against the four known keys,
with bounded list lengths and bounded strings; anything else is dropped rather
than trusted. `resolveTemplate` then sanitises whatever survives against the
active template, so a section id the template does not have is a no-op and a
non-removable section cannot be hidden however the URL is written. Nothing is
persisted, and the stored customisation is neither read nor written.

The console debounces it: reordering three sections is one frame reload, not
three, and typing a heading is one, not one per keystroke.

The console frames this URL in `DevicePreview` at genuine device widths (1280 /
834 / 390), scaled to fit rather than resized — so "desktop" shows a real
desktop layout, not a narrow one pretending to be one.

Framing is permitted by `frame-ancestors` in the storefront's CSP, which allows
the storefront itself and this deployment's console, and nothing else.

---

## What is guaranteed, and where it is proved

`apps/api/test/template-switching.e2e-spec.ts` boots the real application against
the real databases:

| Guarantee                                                                                          | Test                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Products, categories, orders, customers, inventory and settings are byte-identical across a switch | `leaves … identical`                                         |
| Orders are not renumbered and ids are not reissued                                                 | `does not renumber orders or reissue ids`                    |
| One store's switch does not touch another's storefront                                             | `does not change another store's storefront`                 |
| A merchant cannot switch a store they do not belong to                                             | `refuses a merchant switching a store they do not belong to` |
| Preview never changes the stored template                                                          | `never changes the stored template`                          |
| A → B → C → A returns the store to exactly where it started                                        | `returns the store to exactly where it started`              |
| A merchant's layout survives a round trip                                                          | `remembers a merchant's section layout`                      |
| A family the plan lacks is refused server-side; a downgrade keeps the live template and all data   | `entitlements-billing.e2e-spec.ts`                           |
| An unknown template is rejected rather than stored                                                 | `are rejected rather than stored`                            |

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
4. Set `tier`. Standard unless the design is genuinely a different class of
   experience; adding motion to an existing layout is not.
5. Declare `motion`. `restrainedMotion(hover)` for the standard tier.
6. Run `pnpm --filter @retailos/templates test`. The registry has invariants,
   and the interesting ones are about **distinctness**: no two templates may
   share a structure, a header/footer/card combination, or an opening. Sameness
   is a build failure, because reusing a layout is always the cheapest change
   and a catalogue drifts towards it on its own.

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
6. **Motion is never required to understand the page.** Every animation is an
   enhancement over content that already renders. If turning motion off would
   hide something, that is a bug in the section, not in the preference.
7. **Presentation state is never cached on read.** The catalogue is; which
   design a shop is in is not. See "A switch is visible on the very next
   request".
8. **A grid item that holds text needs `min-w-0`.** A grid item's default
   `min-width: auto` is its content's minimum, so one long product name or
   headline widens its column past the viewport and puts the whole page into
   horizontal scroll. This is the single most common way a new section breaks
   on a 360px phone while looking perfect on a laptop.

### Checking a template on a phone

Horizontal overflow is invisible on a desktop and obvious on a handset, so it is
worth measuring rather than eyeballing. Comparing `scrollWidth` against
`clientWidth` at each breakpoint catches it directly; the widths that matter are
1440 / 1280 / 1024 / 834 / 768 / 430 / 390 / 375 / 360. Note that an element
extending past the viewport inside an `overflow-hidden` ancestor — a marquee, for
instance — is fine and expected: it is the *document* that must not scroll.
