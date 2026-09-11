import { NextResponse, type NextRequest } from 'next/server';
import {
  decodePreviewCustomization,
  MAX_ENCODED_LENGTH,
  SECTIONS_PARAM,
  templateExists,
} from '@retailos/templates';

/**
 * Template preview, without a single write.
 *
 * A merchant evaluating a design needs to *use* it — tap a category, open a
 * product, look at the footer — not stare at a screenshot. So preview is the
 * real storefront, serving the real catalogue, rendered through a different
 * template: `?__template=urban-luxe` on any storefront URL.
 *
 * The parameter is promoted to a session cookie here so it survives the
 * navigation that follows, and mirrored onto a request header so *this* render
 * already honours it (a response cookie would only arrive on the next one).
 * `?__template=off` ends the preview.
 *
 * Why this is safe:
 *   - It selects a design. It cannot select a *store* — the tenant is still
 *     resolved from the Host, by the API, exactly as it always is.
 *   - Nothing is persisted. The store's stored template is never read or
 *     written by preview; switching is a separate, authenticated call.
 *   - Unknown ids are ignored rather than trusted, so the value reaching the
 *     renderer is always one of ours.
 *
 * The same machinery carries an *unsaved home-page layout* as `?__sections=`,
 * so the store builder can show a merchant the arrangement they are dragging
 * about before they publish it. It is subject to every guarantee above — see
 * `@retailos/templates/preview` for how it is validated.
 */
const PARAM = '__template';
export const PREVIEW_COOKIE = 'retailos.preview_template';
export const PREVIEW_HEADER = 'x-retailos-preview-template';
export const SECTIONS_COOKIE = 'retailos.preview_sections';
export const SECTIONS_HEADER = 'x-retailos-preview-sections';

/**
 * Cookies cap at about 4 KB, and a draft with a heading on every section can
 * approach that. Over the limit the draft still reaches *this* render through
 * the header — it simply does not survive the next navigation, which is the
 * right trade: the builder re-sends it on every preview refresh anyway.
 */
const MAX_COOKIE_LENGTH = 3000;

export function middleware(request: NextRequest) {
  const requestedTemplate = request.nextUrl.searchParams.get(PARAM);
  const requestedSections = request.nextUrl.searchParams.get(SECTIONS_PARAM);

  // No preview instruction of either kind: carry any existing preview through
  // untouched.
  if (requestedTemplate === null && requestedSections === null) return NextResponse.next();

  const headers = new Headers(request.headers);
  const response = { template: null as string | null, sections: null as string | null };

  if (requestedTemplate !== null) {
    const clearing = requestedTemplate === 'off' || requestedTemplate === '';
    // An id we do not recognise is treated as "no preview" rather than passed on.
    response.template = !clearing && templateExists(requestedTemplate) ? requestedTemplate : null;
    headers.set(PREVIEW_HEADER, response.template ?? 'off');
  }

  if (requestedSections !== null) {
    const clearing = requestedSections === 'off' || requestedSections === '';
    // Decoded here purely to reject rubbish at the edge; the render decodes it
    // again from the header rather than trusting a parsed value across the hop.
    const valid =
      !clearing &&
      requestedSections.length <= MAX_ENCODED_LENGTH &&
      decodePreviewCustomization(requestedSections) !== null;
    response.sections = valid ? requestedSections : null;
    headers.set(SECTIONS_HEADER, response.sections ?? 'off');
  }

  const next = NextResponse.next({ request: { headers } });

  if (requestedTemplate !== null) {
    if (response.template) {
      next.cookies.set(PREVIEW_COOKIE, response.template, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        // A session cookie: closing the tab ends the preview on its own.
      });
    } else {
      next.cookies.delete(PREVIEW_COOKIE);
    }
  }

  if (requestedSections !== null) {
    if (response.sections && response.sections.length <= MAX_COOKIE_LENGTH) {
      next.cookies.set(SECTIONS_COOKIE, response.sections, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    } else {
      next.cookies.delete(SECTIONS_COOKIE);
    }
  }

  return next;
}

export const config = {
  // Skip static assets and the app's own route handlers — they never render a
  // storefront, so there is nothing to preview.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
