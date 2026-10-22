import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import {
  getRoomWithDetails,
  listRoomMessages,
  getLlmSettings,
  getActiveUserPersona,
} from '@/lib/db';

function parseThreeResponses(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // 1. Try JSON parsing if the model returned a JSON array or object
  try {
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean);
        if (cleaned.length >= 3) return cleaned.slice(0, 3);
      }
    }
  } catch {
    // Fall through to line-based parsing
  }

  // 2. Parse numbered or bulleted blocks
  const lines = trimmed
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^\s*(?:option\s*\d+[:.)-]|\d+[:.)-]|[-•*])\s*/i, '')
        .replace(/^["']|["']$/g, '')
        .trim()
    )
    .filter((line) => line.length > 8);

  return lines.slice(0, 3);
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const details = getRoomWithDetails(roomId);
  if (!details) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const settings = getLlmSettings();
  const activePersona = getActiveUserPersona();
  const userName =
    activePersona?.name?.trim() || details.room.userDisplayName || 'Director';
  const userPersonaDesc = activePersona?.description?.trim() || '';

  const activeCharacters = details.roster
    .filter((r) => r.isActive)
    .map((r) => r.character);

  const messages = listRoomMessages(roomId).filter(
    (m) => m.status !== 'streaming' && m.content.trim().length > 0
  );

  const recentTranscript = messages
    .slice(-10)
    .map((m) => `[${m.senderNameSnapshot}]: ${m.content}`)
    .join('\n\n');

  const castSummary = activeCharacters
    .map((c) => `${c.name} (${c.roleTitle}) [Mention tag: @${c.name}]`)
    .join(', ');

  const isLocal =
    settings.baseUrl.includes('localhost') || settings.baseUrl.includes('127.0.0.1');
  const hasKey = Boolean(settings.apiKey.trim()) || isLocal;

  let suggestions: string[] = [];

  if (hasKey) {
    try {
      const client = new OpenAI({
        baseURL: settings.baseUrl.trim() || 'https://api.openai.com/v1',
        apiKey: settings.apiKey.trim() || 'local-no-key',
      });

      const completion = await client.chat.completions.create({
        model: settings.defaultModel || 'gpt-4o-mini',
        temperature: 0.9,
        max_tokens: 450,
        messages: [
          {
            role: 'system',
            content: [
              `You generate 3 distinct, natural roleplay responses for the human user (${userName}) in a multi-character chatroom.`,
              userPersonaDesc ? `User Persona (${userName}): ${userPersonaDesc}` : '',
              `Room Scenario: ${details.room.scenarioPrompt || 'Open multi-character roleplay.'}`,
              `Characters in Room: ${castSummary || 'None'}`,
              `Rules:`,
              `1. Output ONLY a JSON array of 3 strings: ["response 1", "response 2", "response 3"].`,
              `2. Write strictly from ${userName}'s perspective (use *asterisks* for brief physical actions and normal text/quotes for spoken words). Do NOT prefix with "[${userName}]:".`,
              `3. Make the 3 options varied in tone/direction:`,
              `   - Option 1: Direct, engaging conversational reply or question to the last speaker.`,
              `   - Option 2: Expressive or playful reaction with physical action (*...*).`,
              `   - Option 3: A proactive response that specifically @mentions one of the characters (e.g. @CharacterName) to pull them into the spotlight.`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
          {
            role: 'user',
            content: recentTranscript
              ? `Recent conversation:\n${recentTranscript}\n\nGenerate 3 possible next responses for ${userName} as a JSON array of 3 strings:`
              : `The conversation hasn't started yet. Generate 3 engaging opening lines for ${userName} to start the scene as a JSON array of 3 strings:`,
          },
        ],
      });

      const rawOutput = completion.choices[0]?.message?.content || '';
      suggestions = parseThreeResponses(rawOutput);
    } catch {
      // Fall through to smart context-aware generator
    }
  }

  if (suggestions.length < 3) {
    const lastMsg = messages[messages.length - 1];
    const firstChar = activeCharacters[0];
    const secondChar = activeCharacters[1] ?? activeCharacters[0];
    const lastSpeaker =
      lastMsg?.senderType === 'character'
        ? lastMsg.senderNameSnapshot
        : firstChar?.name || 'everyone';

    const targetMentionChar =
      activeCharacters.find((c) => c.name !== lastSpeaker) || firstChar;
    const mentionTag = targetMentionChar ? `@${targetMentionChar.name}` : '';

    const poolOption1 = [
      `*looks toward ${lastSpeaker} thoughtfully* "That's an interesting point, ${lastSpeaker}. Tell me more about what you noticed."`,
      `*leans in slightly and meets ${lastSpeaker}'s eyes* "Hold on—do you really think that's the whole story, or are we missing something?"`,
      `*nods slowly at ${lastSpeaker}* "I see where you're coming from. What do you suggest our next move should be?"`,
      `*smiles faintly at ${lastSpeaker}* "You always manage to surprise me. How long have you been planning that?"`,
    ];

    const poolOption2 = [
      `*crosses arms with an amused grin* "Well, things certainly just got a lot more interesting in here."`,
      `*steps closer, glancing between ${firstChar?.name || 'the room'} and ${secondChar?.name || 'the others'}* "Alright, let's take a breath before anyone jumps to conclusions."`,
      `*chuckles softly and shakes head* "I had a feeling today wouldn't be quiet. Let's hear everyone out."`,
      `*raises an eyebrow curiously* "Wait a second—nobody move. Did anyone else just catch that?"`,
    ];

    const poolOption3 = [
      mentionTag
        ? `*turns attention directly toward ${targetMentionChar?.name}* "${mentionTag}, you've been quiet—what do you make of all this?"`
        : `*looks around the room* "What does everyone else think we should do right now?"`,
      mentionTag
        ? `*gestures toward ${targetMentionChar?.name}* "${mentionTag}, do you agree with ${lastSpeaker}, or do you have another theory?"`
        : `*steps forward decisively* "Let's focus on the main objective before we run out of time."`,
      mentionTag
        ? `*walks over to ${targetMentionChar?.name} with a warm smile* "${mentionTag}, how are you holding up? Come join us over here."`
        : `*takes a seat and gestures for the others to gather closer* "Tell me everything from the beginning."`,
    ];

    const pickRandom = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    suggestions = [
      pickRandom(poolOption1),
      pickRandom(poolOption2),
      pickRandom(poolOption3),
    ];
  }

  return NextResponse.json({
    responses: suggestions.slice(0, 3),
  });
}
