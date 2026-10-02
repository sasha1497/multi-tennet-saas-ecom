import { loadSectionData } from '@/templates/data';
import { TemplateSections } from '@/templates/renderer';
import { activeTemplate } from '@/templates/resolve-server';
import { loadStorefront } from '@/lib/server-api';

/**
 * Store home page.
 *
 * Server-rendered: the tenant is resolved from the Host, the template is
 * resolved from that tenant's stored presentation config, and the browser
 * receives finished HTML in the shop's own design. That matters for retail —
 * it is the difference between a fast first paint on a mid-range phone and a
 * spinner.
 *
 * There is no per-template page here, and there never will be: the template
 * decides which sections exist and in what order, this page renders them, and
 * `loadSectionData` fetches only what those sections actually read.
 */
export default async function HomePage() {
  const bootstrap = await loadStorefront();
  if (!bootstrap) return null; // The layout already rendered the "no store" page.

  const { sections, isPreview } = activeTemplate(bootstrap);
  const data = await loadSectionData(bootstrap, sections, { isPreview });

  return <TemplateSections sections={sections} data={data} />;
}
