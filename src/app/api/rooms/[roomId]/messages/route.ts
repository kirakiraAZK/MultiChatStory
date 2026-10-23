import { NextResponse } from 'next/server';
import {
  listRoomMessages,
  createMessage,
  getRoomWithDetails,
  updateRoomQueueState,
  getActiveUserPersona,
} from '@/lib/db';
import {
  resolveNextCharacterId,
  extractMentionedCharacterIds,
} from '@/lib/ai/turn-scheduler';
import { detectAndApplyEnvironmentFromNarration } from '@/lib/ai/location-detector';

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

  const activePersona = getActiveUserPersona();
  const senderType = body.senderType === 'system' ? 'system' : 'user';
  const senderNameSnapshot =
    senderType === 'system'
      ? 'Stage Direction'
      : String(
          body.senderName ||
            activePersona?.name ||
            details.room.userDisplayName ||
            'Director'
        );

  const created = createMessage({
    roomId,
    senderType,
    characterId: null,
    senderNameSnapshot,
    content,
    status: 'completed',
  });

  // Automatically detect Place, Sub-Place, and Time of Day shifts from user narration / stage direction
  const environmentTransition = detectAndApplyEnvironmentFromNarration(roomId, content);

  const mentionedCharacterIds = extractMentionedCharacterIds(content, details.roster);
  const nextCharId =
    mentionedCharacterIds.length > 0
      ? mentionedCharacterIds[0]
      : resolveNextCharacterId(roomId);

  const remainingMentionQueue =
    mentionedCharacterIds.length > 1 ? mentionedCharacterIds.slice(1) : [];

  updateRoomQueueState(roomId, {
    consecutiveAutoTurns: 0,
    nextCharacterId: nextCharId,
    queuedCharacterIdsJson: JSON.stringify(remainingMentionQueue),
  });

  return NextResponse.json(
    {
      message: created,
      nextCharacterId: nextCharId,
      mentionedCharacterIds,
      environmentTransition,
    },
    { status: 201 }
  );
}
