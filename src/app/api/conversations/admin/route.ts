import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    // Récupérer toutes les conversations avec leurs messages et utilisateurs
    const conversations = await db.conversation.findMany({
      include: {
        users: true,
        messages: {
          include: {
            sender: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Formater les données pour l'admin
    const formattedConversations = conversations.map(conversation => {
      const lastMessage = conversation.messages[0];
      const clientUser = conversation.users.find(user => user.id !== 'admin-user-id');
      
      return {
        id: conversation.id,
        users: conversation.users.map(user => ({
          id: user.id,
          name: user.name || 'Client',
        })),
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          content: lastMessage.content,
          senderId: lastMessage.senderId,
          conversationId: lastMessage.conversationId,
          createdAt: lastMessage.createdAt,
          read: lastMessage.read || false,
          sender: {
            id: lastMessage.sender.id,
            name: lastMessage.sender.name || 'Client',
          },
        } : null,
        unreadCount: conversation.messages.filter(msg => 
          !msg.read && msg.senderId !== 'admin-user-id'
        ).length,
      };
    });

    return NextResponse.json(formattedConversations);
  } catch (error) {
    console.error('Erreur lors de la récupération des conversations:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}