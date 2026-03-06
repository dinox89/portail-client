import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Next 15 requires awaiting dynamic params
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { searchParams } = new URL(request.url);
    const portalToken = searchParams.get('portalToken');
    const { userId } = await params;

    if (portalToken) {
      const clientPortal = await (db as any).clientPortal.findUnique({
        where: { accessToken: portalToken },
        select: { id: true },
      });
      if (!clientPortal?.id || clientPortal.id !== userId) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
    }

    const conversations = await db.conversation.findMany({
      where: {
        users: {
          some: {
            id: userId,
          },
        },
      },
      include: {
        users: true,
        messages: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
