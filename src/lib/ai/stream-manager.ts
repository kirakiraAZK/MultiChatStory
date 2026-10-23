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
  const rawBaseUrl = settings.baseUrl.trim();
  const isLocalEndpoint =
    rawBaseUrl.includes('localhost') || rawBaseUrl.includes('127.0.0.1');
  const hasUsableCredentials = Boolean(settings.apiKey.trim()) || isLocalEndpoint;

  const isSimulatedModel = payload.model === 'simulated' || settings.defaultModel === 'simulated';

  if (isSimulatedModel || (!hasUsableCredentials && settings.useMockFallback)) {
    yield* generateSimulatedCharacterStream(payload, signal);
    return;
  }

  // Branch 1: Anthropic Claude native API
  if (rawBaseUrl.includes('anthropic.com')) {
    try {
      yield* generateAnthropicCharacterStream(payload, settings.apiKey.trim(), signal);
      return;
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

  // Branch 2: OpenAI / OpenRouter / Google Gemini / Ollama / LM Studio / Custom OpenAI-Compatible
  try {
    let effectiveBaseUrl = rawBaseUrl || 'https://api.openai.com/v1';

    // Normalize Google Gemini base URL to its official OpenAI-compatible endpoint
    if (effectiveBaseUrl.includes('generativelanguage.googleapis.com')) {
      if (!effectiveBaseUrl.includes('/openai')) {
        effectiveBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
      }
    }

    const client = new OpenAI({
      baseURL: effectiveBaseUrl,
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
    if (!effectiveBaseUrl.includes('api.openai.com')) {
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

async function* generateAnthropicCharacterStream(
  payload: AssembledPromptPayload,
  apiKey: string,
  signal: AbortSignal
): AsyncGenerator<string, void, unknown> {
  const modelToUse = payload.model || 'claude-3-5-sonnet-20241022';
  const systemMsg = payload.messages.find((m) => m.role === 'system');
  const systemPrompt = typeof systemMsg?.content === 'string' ? systemMsg.content : '';

  // Filter messages for Anthropic (alternating user and assistant)
  const nonSystemMessages = payload.messages.filter((m) => m.role !== 'system');
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const m of nonSystemMessages) {
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content) continue;

    const prev = anthropicMessages[anthropicMessages.length - 1];
    if (prev && prev.role === role) {
      prev.content += `\n\n${content}`;
    } else {
      anthropicMessages.push({ role, content });
    }
  }

  // Ensure conversation starts with a user turn as required by Anthropic
  if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
    anthropicMessages.unshift({ role: 'user', content: '[Director]: Begin the scene.' });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: modelToUse,
      system: systemPrompt,
      messages: anthropicMessages,
      max_tokens: payload.maxTokens,
      temperature: Math.min(1.0, payload.temperature),
      top_p: payload.topP,
      stop_sequences: payload.stopSequences.length > 0 ? payload.stopSequences : undefined,
      stream: true,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Anthropic API error (${response.status}): ${errorBody || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let initialBuffer = '';
  let prefixStripped = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          const delta = parsed.delta.text;
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
      } catch {
        // ignore parse errors for heartbeat lines
      }
    }
  }

  if (!prefixStripped && initialBuffer) {
    const cleaned = stripLeadingSpeakerPrefix(initialBuffer, payload.targetCharacter.name);
    if (cleaned) yield cleaned;
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

  // Extract current sub-place & time from the system prompt if present
  const sysContent =
    typeof payload.messages[0]?.content === 'string' ? payload.messages[0].content : '';
  const subPlaceMatch = sysContent.match(
    /- Current Sub-Place \(Active Scene Area\):\s*([^\n—]+)/
  );
  const timeMatch = sysContent.match(/- Current Time of Day:\s*([^\n(]+)/);
  const currentAreaLabel = subPlaceMatch?.[1]?.trim() || 'this room';
  const currentTimeLabel = timeMatch?.[1]?.trim().toLowerCase() || 'now';

  const templatesByRole: Record<string, string[]> = {
    'Sherlock Holmes': [
      `*glances around the ${currentAreaLabel} in the ${currentTimeLabel} light, then lifts his eyes sharply toward ${prevSpeaker}${loreHint}* You are looking at the surface, yet missing the decisive detail entirely. Consider what was just said—"${prevExcerpt || 'that observation'}"—if the cipher had truly been burned by accident, the wax seal would show thermal blistering. Someone wanted us to read only the surviving four lines.`,
      `*taps the brass cylinder twice against his palm here in the ${currentAreaLabel} and exchanges a swift glance with ${prevSpeaker}* Quite so, though the inference goes a step further. The white camellia is cultivated in only two conservatories in London. Whoever sent this message is already watching our movements.`,
      `*paces once across the ${currentAreaLabel}, fingertips pressed together* Let us test that hypothesis immediately. If ${prevSpeaker} is right, then the second column of figures isn't a naval coordinate at all—it is a timetable.`,
    ],
    'Dr. John Watson': [
      `*looks around the ${currentAreaLabel} during this ${currentTimeLabel} hour and turns toward ${prevSpeaker}* Hold on a moment—if what ${prevSpeaker} suggests about "${prevExcerpt || 'this situation'}" is accurate, then whoever dispatched that tube took an extraordinary personal risk.`,
      `*checks his pocket watch in the ${currentTimeLabel} light of the ${currentAreaLabel} and looks between the others* I bound enough chemical burns in the service to recognize phosphorus residue on that paper. Before we leap into a trap, shouldn't we verify who signed the register?`,
      `*shakes his head slowly in the ${currentAreaLabel}* You make it sound simple, yet ${prevSpeaker} raises a point we cannot ignore. If this is bait, they knew all of us would be here.`,
    ],
    'Irene Adler': [
      `*takes in the atmosphere of the ${currentAreaLabel} this ${currentTimeLabel} with a faint, knowing smile as she turns toward ${prevSpeaker}* How delightfully methodical of you. Yet when you mention "${prevExcerpt || 'the clue'}", you assume the sender wanted the cipher solved rather than delivered. A white camellia isn't a threat—it's an invitation.`,
      `*glances around the ${currentAreaLabel}, eyes bright with amusement* Gentlemen, please. If Whitehall wanted the parchment destroyed, there wouldn't be a single legible numeral left. Respond to ${prevSpeaker}'s question: who benefits the moment we leave?`,
      `*leans back with effortless composure in the ${currentAreaLabel}* You are both dissecting the lock while ignoring who holds the key. Tell me, ${prevSpeaker}, what if the cipher is genuine and the camellia is meant for me?`,
    ],
  };

  const pool = templatesByRole[char.name] ?? [
    `*glances around the ${currentAreaLabel} in the ${currentTimeLabel} atmosphere and turns toward ${prevSpeaker}* Taking into account what ${prevSpeaker} noted regarding "${prevExcerpt || 'our current predicament'}", our next move here in the ${currentAreaLabel} has to be deliberate.`,
    `*nods thoughtfully in the ${currentAreaLabel} in response to ${prevSpeaker}* That aligns with what I've been observing this ${currentTimeLabel}. However, if we look closer at the sequence of events, there's an angle we haven't pressed yet.`,
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
