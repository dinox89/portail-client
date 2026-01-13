import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import jwt from 'jsonwebtoken';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId requis' }, { status: 400 });
  }
  const secret = process.env.REALTIME_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ token: null });
  }
  const exists = await db.user.findUnique({ where: { id: userId } });
  if (!exists) {
    await db.user.create({
      data: { id: userId, email: `${userId}@example.com`, name: `User ${userId}` },
    });
  }
  const token = jwt.sign({ uid: userId }, secret, { expiresIn: '2h' });
  return NextResponse.json({ token });
}

