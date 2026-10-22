import { NextResponse } from 'next/server';
import {
  getRoomWithDetails,
  createMessage,
  finalizeStreamedMessage,
  prepareMessageRegeneration,
  getMessageById,
  updateRoomQueueState,
} from '@/lib/db';
import { buildMultiCharacterPayload } from '@/lib/ai/context-assembler';
import { resolveNextCharacterId } from '@/lib/ai/turn-scheduler';
import {
  registerRoomAbortController,
  clearRoomAbortController,
  abortActiveRoomStream,
  generateCharacterTokenStream,
} from '@/lib/ai/stream-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatSSE(event: string, data: unknown): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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
  const regenerateMessageId = body.regenerateMessageId ? String(body.regenerateMessageId) : null;
  const truncateSubsequent = Boolean(body.truncateSubsequent);
  const isManualTrigger = Boolean(body.isManualTrigger);
  const directAddressTo = body.directAddressTo ? String(body.directAddressTo).trim() : undefined;

  let targetCharacterId: string | null = body.characterId ? String(body.characterId) : null;
  let beforeSequenceNumber: number | undefined = undefined;
  let activeMessageId: string;
  let activeSequenceNumber: number;
  let activeVersionIndex = 1;
  let versionCount = 1;

  // Handle Regeneration vs New Turn Creation
  if (regenerateMessageId) {
    const existingMsg = getMessageById(regenerateMessageId);
    if (!existingMsg || existingMsg.roomId !== roomId || !existingMsg.characterId) {
      return NextResponse.json(
        { error: 'Target character message not found for regeneration' },
        { status: 404 }
      );
    }
    targetCharacterId = existingMsg.characterId;
    beforeSequenceNumber = existingMsg.sequenceNumber;

    const prepared = prepareMessageRegeneration(regenerateMessageId, truncateSubsequent);
    if (!prepared) {
      return NextResponse.json({ error: 'Failed to prepare regeneration' }, { status: 500 });
    }
    activeMessageId = prepared.message.id;
    activeSequenceNumber = prepared.message.sequenceNumber;
    activeVersionIndex = prepared.message.activeVersionIndex;
    versionCount = prepared.message.versionCount;
  } else {
    if (!targetCharacterId) {
      targetCharacterId = resolveNextCharacterId(roomId);
    }
    if (!targetCharacterId) {
      return NextResponse.json(
        { error: 'No active characters assigned to this room' },
        { status: 400 }
      );
    }
  }

  const assembled = buildMultiCharacterPayload(roomId, targetCharacterId, {
    beforeSequenceNumber,
    temperatureOverride: typeof body.temperature === 'number' ? body.temperature : undefined,
    directAddressTo,
  });

  const promptDebugJson = JSON.stringify(
    {
      model: assembled.model,
      temperature: assembled.temperature,
      maxTokens: assembled.maxTokens,
      topP: assembled.topP,
      topK: assembled.topK,
      minP: assembled.minP,
      repetitionPenalty: assembled.repetitionPenalty,
      matchedLoreTitles: assembled.matchedLoreTitles,
      stopSequences: assembled.stopSequences,
      messages: assembled.messages,
    },
    null,
    2
  );

  if (!regenerateMessageId) {
    const placeholder = createMessage({
      roomId,
      senderType: 'character',
      characterId: assembled.targetCharacter.id,
      senderNameSnapshot: assembled.targetCharacter.name,
      content: '',
      status: 'streaming',
      promptDebugJson,
    });
    activeMessageId = placeholder.id;
    activeSequenceNumber = placeholder.sequenceNumber;
    activeVersionIndex = placeholder.activeVersionIndex;
    versionCount = placeholder.versionCount;
  }

  const serverAbortController = new AbortController();
  registerRoomAbortController(roomId, serverAbortController);

  // Link client HTTP request abort signal to our server AbortController
  req.signal.addEventListener('abort', () => {
    if (!serverAbortController.signal.aborted) {
      serverAbortController.abort('Client disconnected or aborted');
    }
  });

  updateRoomQueueState(roomId, {
    executionState: 'STREAMING',
    activeCharacterId: assembled.targetCharacter.id,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let accumulatedText = '';
      try {
        controller.enqueue(
          formatSSE('meta', {
            messageId: activeMessageId,
            characterId: assembled.targetCharacter.id,
            characterName: assembled.targetCharacter.name,
            sequenceNumber: activeSequenceNumber,
            activeVersionIndex,
            versionCount,
            isRegeneration: Boolean(regenerateMessageId),
            truncateSubsequent,
          })
        );

        for await (const delta of generateCharacterTokenStream(
          assembled,
          serverAbortController.signal
        )) {
          if (serverAbortController.signal.aborted) break;
          accumulatedText += delta;
          controller.enqueue(
            formatSSE('delta', {
              messageId: activeMessageId,
              delta,
            })
          );
        }

        if (serverAbortController.signal.aborted) {
          const finalText = accumulatedText.trim() || '*[Interrupted]*';
          const finalized = finalizeStreamedMessage(
            activeMessageId,
            finalText,
            'aborted',
            promptDebugJson
          );
          updateRoomQueueState(roomId, {
            executionState: 'PAUSED',
            activeCharacterId: null,
          });
          controller.enqueue(
            formatSSE('aborted', {
              messageId: activeMessageId,
              message: finalized,
            })
          );
        } else {
          const finalText = accumulatedText.trim() || '...';
          const finalized = finalizeStreamedMessage(
            activeMessageId,
            finalText,
            'completed',
            promptDebugJson
          );

          const latestRoom = getRoomWithDetails(roomId);
          const nextAutoTurns = isManualTrigger
            ? latestRoom?.queueState.consecutiveAutoTurns ?? 0
            : (latestRoom?.queueState.consecutiveAutoTurns ?? 0) + 1;

          const nextCharId = resolveNextCharacterId(roomId, {
            excludeCharacterId: assembled.targetCharacter.id,
          });

          updateRoomQueueState(roomId, {
            executionState: 'COOLDOWN',
            activeCharacterId: null,
            nextCharacterId: nextCharId,
            consecutiveAutoTurns: nextAutoTurns,
          });

          controller.enqueue(
            formatSSE('done', {
              messageId: activeMessageId,
              message: finalized,
              nextCharacterId: nextCharId,
              consecutiveAutoTurns: nextAutoTurns,
            })
          );
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Stream generation failed';
        const fallbackContent = accumulatedText.trim() || `[Error: ${errorMsg}]`;
        const finalized = finalizeStreamedMessage(
          activeMessageId,
          fallbackContent,
          'error',
          promptDebugJson
        );
        updateRoomQueueState(roomId, {
          executionState: 'PAUSED',
          activeCharacterId: null,
        });
        controller.enqueue(
          formatSSE('error', {
            messageId: activeMessageId,
            error: errorMsg,
            message: finalized,
          })
        );
      } finally {
        clearRoomAbortController(roomId, serverAbortController);
        controller.close();
      }
    },
    cancel() {
      if (!serverAbortController.signal.aborted) {
        serverAbortController.abort('ReadableStream cancelled');
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const aborted = abortActiveRoomStream(roomId);
  updateRoomQueueState(roomId, {
    executionState: 'PAUSED',
    activeCharacterId: null,
  });
  return NextResponse.json({ aborted });
}
