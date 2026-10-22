import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  getRoomWithDetails,
  listRoomMessages,
  updateRoom,
  getLlmSettings,
} from '@/lib/db';

export async function POST(
  req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const details = getRoomWithDetails(roomId);
  if (!details) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const messages = listRoomMessages(roomId).filter(
    (m) => m.status !== 'streaming' && m.content.trim().length > 0
  );

  if (messages.length === 0) {
    return NextResponse.json(
      { error: 'No messages in the room to summarize yet.' },
      { status: 400 }
    );
  }

  const settings = getLlmSettings();
  const modelToUse =
    (body.modelId ? String(body.modelId).trim() : '') ||
    details.room.summaryModelId ||
    settings.defaultModel ||
    'gpt-4o-mini';

  const transcriptLines = messages
    .slice(-30)
    .map((m) => `[${m.senderNameSnapshot}]: ${m.content}`)
    .join('\n\n');

  const isLocal =
    settings.baseUrl.includes('localhost') || settings.baseUrl.includes('127.0.0.1');
  const hasKey = Boolean(settings.apiKey.trim()) || isLocal;

  let summaryText = '';

  if (hasKey) {
    try {
      const client = new OpenAI({
        baseURL: settings.baseUrl.trim() || 'https://api.openai.com/v1',
        apiKey: settings.apiKey.trim() || 'local-no-key',
      });

      const completion = await client.chat.completions.create({
        model: modelToUse,
        temperature: 0.4,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise story & memory archivist for a multi-character roleplay room. Summarize the key events, character revelations, active goals, and unresolved mysteries from the transcript so all characters remember them in future turns. Use clear bullet points or a tight paragraph.',
          },
          {
            role: 'user',
            content: `Existing Memory Box:\n${details.room.memoryBox || '(Empty)'}\n\nRecent Transcript:\n${transcriptLines}\n\nWrite an updated, consolidated Memory Summary (under 1500 characters):`,
          },
        ],
      });

      summaryText = completion.choices[0]?.message?.content?.trim() || '';
    } catch {
      // Fall through to deterministic summary builder if API call fails
    }
  }

  if (!summaryText) {
    // Intelligent local summary generator when running in offline/simulated mode
    const participants = Array.from(
      new Set(messages.map((m) => m.senderNameSnapshot))
    ).join(', ');
    const recentHighlights = messages.slice(-5).map((m) => {
      const clean = m.content.replace(/\*[^*]+\*/g, '').trim();
      const snippet = clean.length > 110 ? `${clean.slice(0, 110)}...` : clean;
      return `• ${m.senderNameSnapshot}: "${snippet}"`;
    });

    summaryText = [
      `[Auto-Summary • ${messages.length} turns recorded | Cast: ${participants}]`,
      details.room.scenarioPrompt ? `Setting: ${details.room.scenarioPrompt.slice(0, 180)}` : '',
      `Key Recent Developments:`,
      ...recentHighlights,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const updatedRoom = updateRoom(roomId, {
    memoryBox: summaryText,
    summaryModelId: modelToUse,
  });

  return NextResponse.json({
    memoryBox: summaryText,
    roomDetails: updatedRoom,
  });
}
