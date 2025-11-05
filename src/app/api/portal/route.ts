import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Upsert client portal data
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      uniqueId,
      name,
      contact,
      email,
      progression = 0,
      project,
    } = body || {};

    if (!uniqueId || !name || !contact || !email || !project) {
      return NextResponse.json({ error: 'uniqueId, name, contact, email, project requis' }, { status: 400 });
    }

    const client = await db.clientPortal.upsert({
      where: { id: uniqueId },
      update: {
        name,
        contact,
        email,
        progression,
        project,
      },
      create: {
        id: uniqueId,
        name,
        contact,
        email,
        progression,
        project,
      },
    });

    return NextResponse.json(client);
  } catch (error) {
    console.error('Erreur upsert client portal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}