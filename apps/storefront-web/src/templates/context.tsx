'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { TemplateDefinition, TemplateLayout } from '@retailos/templates';

/**
 * The active design, available to every client component.
 *
 * Components ask this for the *variant* they should render — `productCard`,
 * `header`, `productDetail` — rather than branching on the template id. A new
 * template that reuses existing variants therefore needs no component changes
 * at all, which is the point of having variants in the first place.
 */
interface TemplateContextValue {
  template: TemplateDefinition;
  layout: TemplateLayout;
  /** True while the merchant is trying a design they have not adopted. */
  isPreview: boolean;
}

const TemplateContext = createContext<TemplateContextValue | null>(null);

export function useTemplate(): TemplateContextValue {
  const ctx = useContext(TemplateContext);
  if (!ctx) throw new Error('useTemplate must be used inside <TemplateProvider>');
  return ctx;
}

export function TemplateProvider({
  template,
  isPreview,
  children,
}: {
  template: TemplateDefinition;
  isPreview: boolean;
  children: ReactNode;
}) {
  return (
    <TemplateContext.Provider value={{ template, layout: template.layout, isPreview }}>
      {children}
    </TemplateContext.Provider>
  );
}

/** Tailwind grid classes for a template's product grid, at every breakpoint. */
export function gridClass(layout: TemplateLayout): string {
  const { base, sm, lg, xl } = layout.gridColumns;
  return [COLS[base], SM[sm], LG[lg], XL[xl]].filter(Boolean).join(' ');
}

// Written out rather than interpolated: Tailwind only ships classes it can find
// as complete strings in the source.
const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};
const SM: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};
const LG: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};
const XL: Record<number, string> = {
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
};

/** CSS `aspect-ratio` for product imagery, as an inline style value. */
export function productAspectStyle(layout: TemplateLayout): { aspectRatio: string } {
  return { aspectRatio: layout.productAspect };
}
