import OpenAI from 'openai';
import { getLlmSettings } from '@/lib/db';
import { stripLeadingSpeakerPrefix, type AssembledPromptPayload } from './context-assembler';

declare global {
  // eslint-disable-next-line no-var
  var __activeRoomStreams: Map<string, AbortController> | undefined;
}

function getStreamRegistry(): Map<string, AbortController> {
  if (!global.__activeRoomStreams) {
    global.__activeRoomStreams = new Map<string, AbortController>();
  }
  return global.__activeRoomStreams;
}

export function registerRoomAbortController(roomId: string, controller: AbortController): void {
  const reg = getStreamRegistry();
  const prev = reg.get(roomId);
  if (prev && !prev.signal.aborted) {
    prev.abort('New stream started in room');
  }
  reg.set(roomId, controller);
}

export function abortActiveRoomStream(roomId: string): boolean {
  const reg = getStreamRegistry();
  const existing = reg.get(roomId);
  if (existing && !existing.signal.aborted) {
    existing.abort('Aborted by user');
    reg.delete(roomId);
    return true;
  }
  return false;
}

export function clearRoomAbortController(roomId: string, controller: AbortController): void {
  const reg = getStreamRegistry();
  if (reg.get(roomId) === controller) {
    reg.delete(roomId);
  }
}

export async function* generateCharacterTokenStream(
  payload: AssembledPromptPayload,
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const settings = getLlmSettings();
  const isLocalEndpoint =
    settings.baseUrl.includes('localhost') || settings.baseUrl.includes('127.0.0.1');
  const hasUsableCredentials = Boolean(settings.apiKey.trim()) || isLocalEndpoint;

  if (!hasUsableCredentials && settings.useMockFallback) {
    yield* generateSimulatedCharacterStream(payload, signal);
    return;
  }

  try {
    const client = new OpenAI({
      baseURL: settings.baseUrl.trim() || 'https://api.openai.com/v1',
      apiKey: settings.apiKey.trim() || 'local-no-key-required',
    });

    const modelToUse = payload.model || settings.defaultModel || 'gpt-4o-mini';

    // Include OpenAI-standard samplers + extended OpenRouter / vLLM / Ollama / KoboldCPP parameters
    const requestBody: Record<string, unknown> = {
      model: modelToUse,
      messages: payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.maxTokens,
      top_p: payload.topP,
      frequency_penalty: payload.frequencyPenalty,
      presence_penalty: payload.presencePenalty,
      stop: payload.stopSequences.length > 0 ? payload.stopSequences : undefined,
      stream: true,
    };

    // Pass top_k, min_p, repetition_penalty for providers that support them (OpenRouter, Ollama, LM Studio, vLLM)
    if (!settings.baseUrl.includes('api.openai.com')) {
      requestBody.top_k = payload.topK;
      requestBody.min_p = payload.minP;
      requestBody.repetition_penalty = payload.repetitionPenalty;
    }

    const stream = await client.chat.completions.create(
      requestBody as unknown as Parameters<typeof client.chat.completions.create>[0],
      { signal }
    );

    let initialBuffer = '';
    let prefixStripped = false;

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      if (signal.aborted) break;
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (!delta) continue;

      if (!prefixStripped) {
        initialBuffer += delta;
        if (initialBuffer.length >= 28 || initialBuffer.includes(':') || initialBuffer.includes('\n')) {
          const cleaned = stripLeadingSpeakerPrefix(initialBuffer, payload.targetCharacter.name);
          prefixStripped = true;
          if (cleaned) yield cleaned;
        }
      } else {
        yield delta;
      }
    }

    if (!prefixStripped && initialBuffer) {
      const cleaned = stripLeadingSpeakerPrefix(initialBuffer, payload.targetCharacter.name);
      if (cleaned) yield cleaned;
    }
  } catch (err: unknown) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return;
    }
    if (settings.useMockFallback) {
      yield* generateSimulatedCharacterStream(payload, signal);
      return;
    }
    throw err;
  }
}

async function* generateSimulatedCharacterStream(
  payload: AssembledPromptPayload,
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const char = payload.targetCharacter;
  const userTurns = payload.messages.filter((m) => m.role === 'user');
  const lastTurnRaw =
    typeof userTurns[userTurns.length - 1]?.content === 'string'
      ? (userTurns[userTurns.length - 1].content as string)
      : '';

  const speakerMatch = lastTurnRaw.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
  const prevSpeaker = speakerMatch ? speakerMatch[1] : 'the room';
  const prevExcerpt = speakerMatch
    ? speakerMatch[2].replace(/\*[^*]+\*/g, '').trim().slice(0, 90)
    : 'the situation at hand';

  const loreHint =
    payload.matchedLoreTitles.length > 0
      ? ` (recalling lore: ${payload.matchedLoreTitles[0]})`
      : '';

  const templatesByRole: Record<string, string[]> = {
    'Sherlock Holmes': [
      `*lifts his eyes sharply from the table toward ${prevSpeaker}${loreHint}* You are looking at the surface, yet missing the decisive detail entirely. Consider what was just said—"${prevExcerpt || 'that observation'}"—if the cipher had truly been burned by accident, the wax seal would show thermal blistering. It does not. Someone wanted us to read only the surviving four lines.`,
      `*taps the brass cylinder twice against his palm and exchanges a swift glance with ${prevSpeaker}* Quite so, though the inference goes a step further. The white camellia is cultivated in only two conservatories in London during October. Whoever sent this message is already watching our door.`,
      `*paces once before the fireplace, fingertips pressed together* Let us test that hypothesis immediately. If ${prevSpeaker} is right, then the second column of figures isn't a naval coordinate at all—it is a train timetable from Paddington.`,
    ],
    'Dr. John Watson': [
      `*glances toward ${prevSpeaker} and sets his notebook down beside the lamp* Hold on a moment—if what ${prevSpeaker} suggests about "${prevExcerpt || 'this cipher'}" is accurate, then whoever dispatched that tube took an extraordinary personal risk. Look at the scorch pattern on the edge; that was done with a sulfur match in a hurry.`,
      `*checks his pocket watch and looks between the others* I bound enough chemical burns in the service to recognize phosphorus residue on that paper. Before we leap into a trap, shouldn't we verify who signed the night register at Whitehall?`,
      `*shakes his head slowly, resting a hand on the back of his chair* You make it sound simple, yet ${prevSpeaker} raises a point we cannot ignore. If this is bait, they knew all of us would be in this room tonight.`,
    ],
    'Irene Adler': [
      `*allows a faint, knowing smile as she turns toward ${prevSpeaker}* How delightfully methodical of you. Yet when you mention "${prevExcerpt || 'the clue'}", you assume the sender wanted the cipher solved rather than delivered. A white camellia isn't a threat—it's an invitation.`,
      `*traces the rim of her teacup lightly, eyes bright with amusement* Gentlemen, please. If Whitehall wanted the parchment destroyed, there wouldn't be a single legible numeral left. Respond to ${prevSpeaker}'s question: who benefits the moment Sherlock Holmes leaves Baker Street tonight?`,
      `*leans back with effortless composure* You are both dissecting the lock while ignoring who holds the key. Tell me, ${prevSpeaker}, what if the cipher is genuine and the camellia is meant for me?`,
    ],
  };

  const pool = templatesByRole[char.name] ?? [
    `*turns toward ${prevSpeaker}, considering the point carefully* Taking into account what ${prevSpeaker} noted regarding "${prevExcerpt || 'our current predicament'}", our next move has to be deliberate. Every detail in this room points to a coordinated setup.`,
    `*nods thoughtfully in response to ${prevSpeaker}* That aligns with what I've been observing. However, if we look closer at the sequence of events, there's an angle we haven't pressed yet.`,
  ];

  const chosenText = pool[Math.floor(Math.random() * pool.length)];
  const tokens = chosenText.match(/\S+\s*/g) ?? [chosenText];

  for (const token of tokens) {
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, 32));
    if (signal.aborted) return;
    yield token;
  }
}
