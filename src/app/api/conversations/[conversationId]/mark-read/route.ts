import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Next 15 requires awaiting dynamic params
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const portalToken = searchParams.get('portalToken');
    const { conversationId } = await params;
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID requis' }, { status: 400 });
    }

    if (portalToken) {
      const clientPortal = await (db as any).clientPortal.findUnique({
        where: { accessToken: portalToken },
        select: { id: true },
      });
      if (!clientPortal?.id || clientPortal.id !== userId) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
      const hasAccess = await (db as any).conversation.findFirst({
        where: { id: conversationId, users: { some: { id: clientPortal.id } } },
        select: { id: true },
      });
      if (!hasAccess) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
    }

    // Marquer tous les messages non lus de cette conversation comme lus
    const updatedMessages = await db.message.updateMany({
      where: {
        conversationId,
        senderId: {
          not: userId, // Ne pas marquer ses propres messages comme lus
        },
        read: false,
      },
      data: {
        read: true,
      },
    });

    return NextResponse.json({ 
      success: true, 
      updatedCount: updatedMessages.count 
    });
  } catch (error) {
    console.error('Erreur lors du marquage des messages comme lus:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
