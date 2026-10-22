import { NextResponse } from 'next/server';
import { updateCharacter, deleteCharacter } from '@/lib/db';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await context.params;
  const body = await req.json();
  const updated = updateCharacter(characterId, body);
  if (!updated) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 });
  }
  return NextResponse.json({ character: updated });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ characterId: string }> }
) {
  const { characterId } = await context.params;
  deleteCharacter(characterId);
  return NextResponse.json({ ok: true });
}
