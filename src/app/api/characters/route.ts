import { NextResponse } from 'next/server';
import { listCharacters, createCharacter } from '@/lib/db';

export async function GET() {
  const chars = listCharacters();
  return NextResponse.json({ characters: chars });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const created = createCharacter({
      name: String(body.name || 'New Character').trim(),
      roleTitle: String(body.roleTitle || 'Participant').trim(),
      avatarColor: String(body.avatarColor || '#6366f1'),
      avatarUrl: body.avatarUrl ? String(body.avatarUrl) : null,
      systemPrompt: String(body.systemPrompt || 'You are a helpful character in a multi-character story.'),
      speakingStyle: String(body.speakingStyle || ''),
      modelId: String(body.modelId || 'gpt-4o-mini'),
      temperature: Number(body.temperature ?? 0.75),
      maxTokens: Number(body.maxTokens ?? 450),
    });
    return NextResponse.json({ character: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create character' },
      { status: 400 }
    );
  }
}
