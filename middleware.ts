import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const adminCookieName = 'admin_session';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname.startsWith('/portal/')) return NextResponse.next();
  if (pathname.startsWith('/api/portal/')) return NextResponse.next();
  if (pathname.startsWith('/admin/login')) return NextResponse.next();
  if (pathname.startsWith('/api/admin/login') || pathname.startsWith('/api/admin/logout')) {
    return NextResponse.next();
  }
  const portalToken = searchParams.get('portalToken');
  if (portalToken) return NextResponse.next();
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;
  const isDev = process.env.NODE_ENV !== 'production';
  const hasAdminCookie = sessionSecret
    ? request.cookies.get(adminCookieName)?.value === sessionSecret
    : isDev;
  if (pathname === '/' && !hasAdminCookie) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }
  if (
    pathname.startsWith('/api/portal') ||
    pathname.startsWith('/api/conversations') ||
    pathname.startsWith('/api/realtime/token')
  ) {
    if (!hasAdminCookie) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/api/portal/:path*',
    '/api/conversations/:path*',
    '/api/realtime/token',
    '/portal/:path*',
    '/api/admin/:path*',
  ],
};
