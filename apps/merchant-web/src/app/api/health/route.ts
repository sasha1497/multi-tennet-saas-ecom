import { NextResponse } from 'next/server';

/**
 * Container healthcheck target.
 *
 * Deliberately does not call the API: this endpoint answers "is the Next server
 * up?", and coupling it to a downstream dependency would have Docker restart a
 * perfectly healthy web container during an API blip.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'merchant-web' });
}
