import { NextResponse } from 'next/server';
import {
  editMessageInline,
  switchMessageVersion,
  deleteMessage,
  getMessageById,
} from '@/lib/db';
import { abortActiveRoomStream } from '@/lib/ai/stream-manager';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ roomId: string; messageId: string }> }
) {
  const { roomId, messageId } = await context.params;
  const body = await req.json();

  // Ensure any active stream in this room is halted before modifying transcript history
  abortActiveRoomStream(roomId);

  if (typeof body.targetVersionIndex === 'number') {
    const switched = switchMessageVersion(messageId, body.targetVersionIndex);
    if (!switched) {
      return NextResponse.json({ error: 'Message or version not found' }, { status: 404 });
    }
    return NextResponse.json({ message: switched });
  }

  if (typeof body.content === 'string') {
    const trimmed = body.content.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Edited message cannot be empty' }, { status: 400 });
    }
    const updated = editMessageInline(messageId, trimmed);
    if (!updated) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    return NextResponse.json({ message: updated });
  }

  return NextResponse.json({ error: 'Invalid PATCH payload' }, { status: 400 });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ roomId: string; messageId: string }> }
) {
  const { roomId, messageId } = await context.params;
  abortActiveRoomStream(roomId);
  const existing = getMessageById(messageId);
  if (!existing) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }
  deleteMessage(messageId);
  return NextResponse.json({ ok: true });
}
