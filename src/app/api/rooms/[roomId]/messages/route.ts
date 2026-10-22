import { NextResponse } from 'next/server';
import {
  listRoomMessages,
  createMessage,
  getRoomWithDetails,
  updateRoomQueueState,
} from '@/lib/db';
import { resolveNextCharacterId } from '@/lib/ai/turn-scheduler';

export async function GET(
  _req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const messages = listRoomMessages(roomId);
  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const details = getRoomWithDetails(roomId);
  if (!details) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const body = await req.json();
  const content = String(body.content ?? '').trim();
  if (!content) {
    return NextResponse.json({ error: 'Message content cannot be empty' }, { status: 400 });
  }

  const senderType = body.senderType === 'system' ? 'system' : 'user';
  const senderNameSnapshot =
    senderType === 'system'
      ? 'Stage Direction'
      : String(body.senderName || details.room.userDisplayName || 'Director');

  const created = createMessage({
    roomId,
    senderType,
    characterId: null,
    senderNameSnapshot,
    content,
    status: 'completed',
  });

  // Reset consecutive auto-turn counter on human intervention and compute next character
  const nextCharId = resolveNextCharacterId(roomId);
  updateRoomQueueState(roomId, {
    consecutiveAutoTurns: 0,
    nextCharacterId: nextCharId,
  });

  return NextResponse.json(
    {
      message: created,
      nextCharacterId: nextCharId,
    },
    { status: 201 }
  );
}
