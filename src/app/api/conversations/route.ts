import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { userId1, userId2 } = await request.json();

    if (!userId1 || !userId2) {
      return NextResponse.json({ error: 'Missing user IDs' }, { status: 400 });
    }

    // Make sure both users exist; create placeholder users if they don't.
    const user1 = await db.user.upsert({
      where: { id: userId1 },
      update: {},
      create: {
        id: userId1,
        email: `${userId1}@example.com`,
        name: `User ${userId1}`,
      },
    });

    const user2 = await db.user.upsert({
      where: { id: userId2 },
      update: {},
      create: {
        id: userId2,
        email: `${userId2}@example.com`,
        name: `User ${userId2}`,
        role: 'admin',
      },
    });

    const existingConversation = await db.conversation.findFirst({
      where: {
        AND: [
          { users: { some: { id: user1.id } } },
          { users: { some: { id: user2.id } } },
        ],
      },
      include: { users: true },
    });

    if (existingConversation) {
      return NextResponse.json(existingConversation);
    }

    const newConversation = await db.conversation.create({
      data: {
        users: {
          connect: [{ id: user1.id }, { id: user2.id }],
        },
      },
      include: { users: true },
    });

    return NextResponse.json(newConversation);
  } catch (error) {
    console.error('Error creating conversation:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
