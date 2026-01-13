import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getIO } from '@/lib/socket';
import { rateLimiter, getClientKey } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const key = getClientKey(request);
    if (!rateLimiter.check(key)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
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

    const client = await (db as any).clientPortal.upsert({
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

    try {
      const io = getIO();
      if (io) {
        io.emit('portalUpdate', { userId: uniqueId, client });
      }
    } catch (emitErr) {
      console.warn('Emission portalUpdate échouée:', emitErr);
    }

    return NextResponse.json(client);
  } catch (error) {
    console.error('Erreur upsert client portal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const uniqueId = body?.uniqueId as string | undefined;

    if (!uniqueId) {
      return NextResponse.json({ error: 'uniqueId requis' }, { status: 400 });
    }

    const prisma = db as any;

    const conversations = await prisma.conversation.findMany({
      where: {
        users: {
          some: {
            id: uniqueId,
          },
        },
      },
      select: {
        id: true,
      },
    });

    const conversationIds = conversations.map((c: { id: string }) => c.id);

    if (conversationIds.length > 0) {
      await prisma.message.deleteMany({
        where: {
          conversationId: {
            in: conversationIds,
          },
        },
      });

      await prisma.conversation.deleteMany({
        where: {
          id: {
            in: conversationIds,
          },
        },
      });
    }

    await prisma.user.deleteMany({
      where: {
        id: uniqueId,
      },
    });

    await prisma.clientPortal.deleteMany({
      where: {
        id: uniqueId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression client portal:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
