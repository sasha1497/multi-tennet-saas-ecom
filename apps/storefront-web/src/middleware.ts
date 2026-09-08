import { NextResponse, type NextRequest } from 'next/server';
import { templateExists } from '@retailos/templates';

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
 */
const PARAM = '__template';
export const PREVIEW_COOKIE = 'retailos.preview_template';
export const PREVIEW_HEADER = 'x-retailos-preview-template';

export function middleware(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get(PARAM);

  // No preview instruction: carry any existing preview through untouched.
  if (requested === null) return NextResponse.next();

  const clearing = requested === 'off' || requested === '';
  // An id we do not recognise is treated as "no preview" rather than passed on.
  const templateId = !clearing && templateExists(requested) ? requested : null;

  const headers = new Headers(request.headers);
  headers.set(PREVIEW_HEADER, templateId ?? 'off');

  const response = NextResponse.next({ request: { headers } });

  if (templateId) {
    response.cookies.set(PREVIEW_COOKIE, templateId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // A session cookie: closing the tab ends the preview on its own.
    });
  } else {
    response.cookies.delete(PREVIEW_COOKIE);
  }

  return response;
}

export const config = {
  // Skip static assets and the app's own route handlers — they never render a
  // storefront, so there is nothing to preview.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
