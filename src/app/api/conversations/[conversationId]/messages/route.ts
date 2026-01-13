import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { rateLimiter, getClientKey } from '@/lib/rateLimit';
// Utiliser un alias assoupli pour éviter les erreurs de typage sur les délégués Prisma
const prisma = db as any;

// GET - Récupérer les messages d'une conversation
// Next 15 requires awaiting dynamic params
export async function GET(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
      },
      include: {
        sender: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Erreur lors de la récupération des messages:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST - Envoyer un nouveau message
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const key = getClientKey(request);
    if (!rateLimiter.check(key)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    const { conversationId } = await params;
    const { content, senderId } = await request.json();

    if (!content || !senderId) {
      return NextResponse.json({ error: 'Contenu et senderId requis' }, { status: 400 });
    }

    // Créer le nouveau message
    const message = await prisma.message.create({
      data: {
        content,
        senderId,
        conversationId,
        read: false,
      },
      include: {
        sender: true,
      },
    });

    // Mettre à jour la date de mise à jour de la conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // Émettre l'événement Socket.IO pour les notifications en temps réel
    const { getIO } = await import('@/lib/socket');
    const io = getIO();

    if (io) {
      // Diffuser le nouveau message dans la room de la conversation
      io.to(conversationId).emit('newMessage', {
        ...message,
        sender: {
          id: message.sender.id,
          name: message.sender.name || 'Admin',
        },
      });

      // Construire une payload complète pour les administrateurs afin d'éviter un rafraîchissement
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { users: { select: { id: true, role: true, name: true } } },
      });

      if (conversation) {
        const adminUser = conversation.users.find(u => u.role === 'admin');
        const clientUser = conversation.users.find(u => u.role !== 'admin');

        // Ne notifier les admins QUE lorsqu'un client envoie un message
        if (message.sender.role !== 'admin' && clientUser) {
          // Compter les messages non lus pour l'admin (messages du client non lus)
          const unreadCount = await prisma.message.count({
            where: { conversationId, senderId: clientUser.id, read: false },
          });

          io.to('admins').emit('adminNewMessage', {
            conversationId,
            message: {
              id: message.id,
              content: message.content,
              senderId: message.senderId,
              createdAt: message.createdAt,
            },
            unreadCount,
            clientId: clientUser.id,
            clientName: clientUser.name || clientUser.id || 'Client',
          });
        }
      }
    }

    return NextResponse.json(message);
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
