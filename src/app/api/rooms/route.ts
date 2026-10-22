import { NextResponse } from 'next/server';
import { listRooms, createRoom, getRoomWithDetails } from '@/lib/db';

export async function GET() {
  const roomsList = listRooms();
  const detailed = roomsList.map((r) => getRoomWithDetails(r.id)).filter(Boolean);
  return NextResponse.json({ rooms: detailed });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const created = createRoom({
      title: String(body.title || 'Untitled Room').trim(),
      scenarioPrompt: String(body.scenarioPrompt || ''),
      userDisplayName: String(body.userDisplayName || 'Director').trim(),
      turnStrategy: body.turnStrategy || 'round_robin',
      cooldownMs: Number(body.cooldownMs ?? 3000),
      maxAutoTurns: Number(body.maxAutoTurns ?? 8),
      contextWindowLimit: Number(body.contextWindowLimit ?? 30),
      roster: Array.isArray(body.roster) ? body.roster : [],
    });
    return NextResponse.json({ roomDetails: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create room' },
      { status: 400 }
    );
  }
}
