import type { Metadata } from 'next';
import {
  Faq,
  Features,
  FinalCta,
  Hero,
  HowItWorks,
  Pricing,
  Showcase,
  Templates,
  Value,
} from '@/components/marketing/sections';

export const metadata: Metadata = {
  title: 'RetailOS — Launch your online store without the complexity',
  description:
    'Create a professional online store in minutes. Choose a design built for your trade, add your products, and run orders, customers and stock from one console.',
  openGraph: {
    title: 'RetailOS — Launch your online store without the complexity',
    description:
      'Create a professional online store in minutes. Choose a design built for your trade, add your products, and run orders, customers and stock from one console.',
    type: 'website',
  },
};

/**
 * The public home page.
 *
 * Order is the argument: what it is, why it is worth it, how it works, what the
 * console looks like, what your shop could look like, what is actually in the
 * box, what it costs, and the questions people ask before signing up.
 *
 * Both calls to action point at `/register`, which is the store-creation flow
 * that already exists — the same endpoint, the same provisioning, the same
 * welcome screen. Nothing here duplicates authentication.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <Value />
      <HowItWorks />
      <Showcase />
      <Templates />
      <Features />
      <Pricing />
      <Faq />
      <FinalCta />
    </>
  );
}
