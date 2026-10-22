import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getRoomWithDetails, listRoomMessages, getCharacter } from '@/lib/db';
import type { Character } from '@/lib/db/schema';

export interface AssembledPromptPayload {
  targetCharacter: Character;
  model: string;
  temperature: number;
  maxTokens: number;
  stopSequences: string[];
  messages: ChatCompletionMessageParam[];
}

function sanitizeOpenAIName(rawName: string): string {
  const cleaned = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'Participant';
}

export function buildMultiCharacterPayload(
  roomId: string,
  targetCharacterId: string,
  options?: {
    beforeSequenceNumber?: number;
    temperatureOverride?: number;
  }
): AssembledPromptPayload {
  const roomDetails = getRoomWithDetails(roomId);
  if (!roomDetails) {
    throw new Error(`Room ${roomId} not found`);
  }

  const { room, roster } = roomDetails;
  const rosterEntry = roster.find((r) => r.characterId === targetCharacterId);
  const targetCharacter = rosterEntry?.character ?? getCharacter(targetCharacterId);

  if (!targetCharacter) {
    throw new Error(`Target character ${targetCharacterId} not found`);
  }

  const allMessages = listRoomMessages(roomId);
  const filteredMessages = allMessages.filter((m) => {
    if (options?.beforeSequenceNumber !== undefined && m.sequenceNumber >= options.beforeSequenceNumber) {
      return false;
    }
    if (m.status === 'streaming') return false;
    return m.content.trim().length > 0;
  });

  const windowedMessages = filteredMessages.slice(-room.contextWindowLimit);

  // Build other participant descriptions for the system prompt
  const otherParticipantsLines: string[] = [
    `- ${room.userDisplayName} (Human User / Director in the room)`,
  ];

  const participantNames = new Set<string>([room.userDisplayName, targetCharacter.name]);

  for (const member of roster) {
    participantNames.add(member.character.name);
    if (member.characterId === targetCharacter.id) continue;
    otherParticipantsLines.push(
      `- ${member.character.name} (${member.character.roleTitle})${
        member.isActive ? '' : ' [Currently Inactive]'
      }`
    );
  }

  const relationshipSection = rosterEntry?.relationshipContext?.trim()
    ? `\n### YOUR RELATIONSHIPS IN THIS ROOM\n${rosterEntry.relationshipContext.trim()}\n`
    : '';

  const speakingStyleSection = targetCharacter.speakingStyle?.trim()
    ? `\nSpeaking Style & Cadence: ${targetCharacter.speakingStyle.trim()}`
    : '';

  const systemPromptContent = [
    `### SCENARIO & SHARED ENVIRONMENT`,
    room.scenarioPrompt.trim() || 'An open multi-character conversation room.',
    ``,
    `### YOUR IDENTITY`,
    `You are ${targetCharacter.name} (${targetCharacter.roleTitle}).`,
    targetCharacter.systemPrompt.trim(),
    speakingStyleSection,
    relationshipSection,
    `### OTHER PARTICIPANTS IN THIS ROOM`,
    otherParticipantsLines.join('\n'),
    ``,
    `### STRICT MULTI-CHARACTER RULES`,
    `1. Stay 100% in character as ${targetCharacter.name}.`,
    `2. Respond directly to the latest developments in the transcript.`,
    `3. NEVER write dialogue, thoughts, or actions on behalf of ${room.userDisplayName} or any other character.`,
    `4. Do NOT prefix your response with "[${targetCharacter.name}]:" or "${targetCharacter.name}:". Output your dialogue and actions directly.`,
  ]
    .filter(Boolean)
    .join('\n');

  const apiMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPromptContent,
    },
  ];

  // Target-Perspective Transcript Remapping:
  // - Self messages -> role: 'assistant' (raw content without prefix)
  // - Other characters & Human user -> role: 'user' with "[Speaker Name]: " prefix
  for (const msg of windowedMessages) {
    if (msg.senderType === 'system') {
      apiMessages.push({
        role: 'system',
        content: `[Room Event]: ${msg.content}`,
      });
      continue;
    }

    const isSelf = msg.senderType === 'character' && msg.characterId === targetCharacter.id;
    if (isSelf) {
      apiMessages.push({
        role: 'assistant',
        name: sanitizeOpenAIName(targetCharacter.name),
        content: stripLeadingSpeakerPrefix(msg.content, targetCharacter.name),
      });
    } else {
      const speakerLabel = msg.senderNameSnapshot || 'Participant';
      participantNames.add(speakerLabel);
      apiMessages.push({
        role: 'user',
        name: sanitizeOpenAIName(speakerLabel),
        content: `[${speakerLabel}]: ${stripLeadingSpeakerPrefix(msg.content, speakerLabel)}`,
      });
    }
  }

  // Post-history anchor to prevent persona drift on long transcripts
  apiMessages.push({
    role: 'system',
    content: `[System Directive]: Now respond strictly as ${targetCharacter.name}.${
      targetCharacter.speakingStyle ? ` Maintain style: ${targetCharacter.speakingStyle}` : ''
    } Do not prefix your message with your name and do not write turns for any other participant.`,
  });

  // Construct stop sequences so the LLM halts immediately if it tries to write another speaker's turn
  const stopSequences: string[] = [];
  for (const name of participantNames) {
    if (!name) continue;
    stopSequences.push(`\n[${name}]:`);
    stopSequences.push(`\n${name}:`);
    if (stopSequences.length >= 4) break; // OpenAI API allows max 4 stop sequences
  }

  return {
    targetCharacter,
    model: targetCharacter.modelId,
    temperature: options?.temperatureOverride ?? targetCharacter.temperature,
    maxTokens: targetCharacter.maxTokens,
    stopSequences: stopSequences.slice(0, 4),
    messages: apiMessages,
  };
}

export function stripLeadingSpeakerPrefix(text: string, speakerName: string): string {
  const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstName = speakerName.split(' ')[0]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^\\s*(?:\\[(?:${escaped}|${firstName})\\]|(?:${escaped}|${firstName}))\\s*:\\s*`,
    'i'
  );
  return text.replace(pattern, '');
}
