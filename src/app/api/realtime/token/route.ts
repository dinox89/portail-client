import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import jwt from 'jsonwebtoken';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const portalToken = searchParams.get('portalToken');
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ token: null });
  }
  let resolvedUserId = '';
  if (portalToken) {
    const clientPortal = await (db as any).clientPortal.findUnique({
      where: { accessToken: portalToken },
      select: { id: true },
    });
    if (!clientPortal?.id) {
      return NextResponse.json({ error: 'Token portail invalide' }, { status: 404 });
    }
    resolvedUserId = clientPortal.id;
  } else if (userId) {
    const adminId = process.env.NEXT_PUBLIC_ADMIN_USER_ID || 'admin-user-id';
    if (userId !== adminId) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }
    resolvedUserId = userId;
  } else {
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
  }

  const exists = await db.user.findUnique({ where: { id: resolvedUserId } });
  if (!exists) {
    if (portalToken) {
      await db.user.create({
        data: { id: resolvedUserId, email: `${resolvedUserId}@example.com`, name: `User ${resolvedUserId}` },
      });
    } else {
      return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 });
    }
  }
  const token = jwt.sign({ uid: resolvedUserId }, secret, { expiresIn: '2h' });
  return NextResponse.json({ token });
}
