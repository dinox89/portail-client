import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Get client portal data by unique id
// Next 15 requires awaiting dynamic params
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'ID manquant' }, { status: 400 });
    }

    const client = await db.clientPortal.findUnique({ where: { id } });
    if (!client) {
      return NextResponse.json({ error: 'Client non trouvé' }, { status: 404 });
    }

    return NextResponse.json(client);
  } catch (error) {
    console.error('Erreur de récupération client portal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}