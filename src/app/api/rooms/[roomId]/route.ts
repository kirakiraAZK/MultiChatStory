import { NextResponse } from 'next/server';
import { getRoomWithDetails, updateRoom, deleteRoom, listRoomMessages } from '@/lib/db';
import { resolveNextCharacterId } from '@/lib/ai/turn-scheduler';

export async function GET(
  _req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const details = getRoomWithDetails(roomId);
  if (!details) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  const messages = listRoomMessages(roomId);
  const suggestedNextCharacterId = resolveNextCharacterId(roomId);
  return NextResponse.json({
    ...details,
    messages,
    suggestedNextCharacterId,
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const body = await req.json();
  const updated = updateRoom(roomId, body);
  if (!updated) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  deleteRoom(roomId);
  return NextResponse.json({ ok: true });
}
