import type { TemplateSection } from '@retailos/templates';
import type { SectionData } from './data';
import { Reveal } from './motion';
import { CategoriesSection } from './sections/categories';
import { HeroSection } from './sections/hero';
import { catalogueIsEmpty, EmptyCatalogue, ProductRowSection } from './sections/product-row';
import {
  BrandsSection,
  CollectionBannerSection,
  EditorialSection,
  NewsletterSection,
  OffersSection,
  TestimonialsSection,
  TrustStripSection,
} from './sections/panels';

/**
 * Renders a resolved template's sections against the store's data.
 *
 * The whole of "template switching" on the render side is this loop reading a
 * different list. Sections receive data; they never fetch it and never own it.
 *
 * Unknown section kinds render nothing rather than throwing: a store pinned to
 * an older template version must keep working when the catalogue moves on.
 *
 * Every section below the first is wrapped in a `Reveal`. On a standard
 * template that wrapper collapses to its children and costs nothing; on a
 * premium one it is what makes the page arrive in chapters rather than all at
 * once. The hero is excluded deliberately — it is above the fold, so animating
 * it in would mean the first thing a visitor sees is an empty screen.
 */
export function TemplateSections({
  sections,
  data,
}: {
  sections: readonly TemplateSection[];
  data: SectionData;
}) {
  // A store with nothing published would otherwise render as a hero above a
  // stack of silently-dropped rows. Say so once, plainly.
  const noCatalogue = catalogueIsEmpty(data.products);

  return (
    <>
      {sections.map((section, index) => {
        const rendered = renderSection(section, data);
        if (!rendered) return null;

        // The hero renders its own internal motion and must paint immediately.
        if (section.kind === 'hero' || index === 0) {
          return <div key={section.id}>{rendered}</div>;
        }

        return (
          <Reveal key={section.id} as="div">
            {rendered}
          </Reveal>
        );
      })}

      {noCatalogue && <EmptyCatalogue storeName={data.store.storeName} />}
    </>
  );
}

function renderSection(section: TemplateSection, data: SectionData): React.ReactNode {
  switch (section.kind) {
    case 'hero':
      return <HeroSection section={section} data={data} />;
    case 'trustStrip':
      return <TrustStripSection section={section} data={data} />;
    case 'categories':
      return <CategoriesSection section={section} data={data} />;
    case 'productRow':
      return <ProductRowSection section={section} data={data} />;
    case 'collectionBanner':
      return <CollectionBannerSection section={section} data={data} />;
    case 'brands':
      return <BrandsSection section={section} data={data} />;
    case 'editorial':
      return <EditorialSection section={section} data={data} />;
    case 'offers':
      return <OffersSection section={section} data={data} />;
    case 'testimonials':
      return <TestimonialsSection section={section} data={data} />;
    case 'newsletter':
      return <NewsletterSection section={section} data={data} />;
    default:
      return null;
  }
}
