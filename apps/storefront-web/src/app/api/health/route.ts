import { NextResponse } from 'next/server';

/** Container healthcheck. Reports only on this Next server, not the API. */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok', service: 'storefront-web' });
}
