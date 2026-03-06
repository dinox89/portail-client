import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const password = body?.password as string | undefined;
    const expected = process.env.ADMIN_PASSWORD || 'admin';
    const sessionSecret = process.env.ADMIN_SESSION_SECRET;
    if (!sessionSecret) {
      return NextResponse.json({ error: 'ADMIN_SESSION_SECRET manquant' }, { status: 500 });
    }
    if (!password || password !== expected) {
      return NextResponse.json({ error: 'Mot de passe invalide' }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set('admin_session', sessionSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
