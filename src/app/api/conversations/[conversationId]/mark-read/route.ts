import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Next 15 requires awaiting dynamic params
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID requis' }, { status: 400 });
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