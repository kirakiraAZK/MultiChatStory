import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getRoomWithDetails,
  updateRoom,
  deleteRoom,
  listRoomMessages,
  parseRoomSubPlaces,
} from '@/lib/db';
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

  // 1. Clean up physical generated background image cache files on disk
  try {
    const details = getRoomWithDetails(roomId);
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'backgrounds');
    const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, '');

    const filenamesToDelete = new Set<string>();
    if (details?.room.subPlacesJson) {
      const subPlaces = parseRoomSubPlaces(details.room.subPlacesJson);
      for (const sp of subPlaces) {
        if (sp.backgroundsByTime) {
          for (const url of Object.values(sp.backgroundsByTime)) {
            if (typeof url === 'string' && url.startsWith('/uploads/backgrounds/')) {
              filenamesToDelete.add(path.basename(url));
            }
          }
        }
      }
    }

    const files = await fs.readdir(uploadDir).catch(() => [] as string[]);
    for (const f of files) {
      if (f.startsWith(`bg_${safeRoom}_`) || filenamesToDelete.has(f)) {
        await fs.unlink(path.join(uploadDir, f)).catch(() => {});
      }
    }
  } catch {
    // Disk cleanup error ignored to allow DB deletion to proceed
  }

  // 2. Cascade delete all chat messages, versions, queue states, and room record in SQLite
  deleteRoom(roomId);
  return NextResponse.json({ ok: true });
}
