import type { TemplateSection } from '@retailos/templates';
import type { SectionData } from './data';
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
      {sections.map((section) => {
        const rendered = renderSection(section, data);
        if (!rendered) return null;
        return <div key={section.id}>{rendered}</div>;
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
