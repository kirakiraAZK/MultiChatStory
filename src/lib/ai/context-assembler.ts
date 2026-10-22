import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import {
  getRoomWithDetails,
  listRoomMessages,
  getCharacter,
  getLlmSettings,
  listSystemPrompts,
  getActiveUserPersona,
  listLorebooksWithEntries,
} from '@/lib/db';
import type { Character } from '@/lib/db/schema';

export interface AssembledPromptPayload {
  targetCharacter: Character;
  model: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  minP: number;
  repetitionPenalty: number;
  frequencyPenalty: number;
  presencePenalty: number;
  stopSequences: string[];
  matchedLoreTitles: string[];
  messages: ChatCompletionMessageParam[];
}

function sanitizeOpenAIName(rawName: string): string {
  const cleaned = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'Participant';
}

export function replaceTavernMacros(
  text: string,
  charName: string,
  userName: string
): string {
  if (!text) return '';
  return text
    .replace(/\{\{\s*char\s*\}\}/gi, charName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName);
}

export function buildMultiCharacterPayload(
  roomId: string,
  targetCharacterId: string,
  options?: {
    beforeSequenceNumber?: number;
    temperatureOverride?: number;
    directAddressTo?: string;
  }
): AssembledPromptPayload {
  const roomDetails = getRoomWithDetails(roomId);
  if (!roomDetails) {
    throw new Error(`Room ${roomId} not found`);
  }

  const settings = getLlmSettings();
  const { room, roster } = roomDetails;
  const rosterEntry = roster.find((r) => r.characterId === targetCharacterId);
  const targetCharacter = rosterEntry?.character ?? getCharacter(targetCharacterId);

  if (!targetCharacter) {
    throw new Error(`Target character ${targetCharacterId} not found`);
  }

  // Resolve Active User Persona
  const activePersona = getActiveUserPersona();
  const effectiveUserName = activePersona?.name?.trim() || room.userDisplayName || 'Director';

  // Resolve Active Tavern System Prompt Preset
  const allSystemPrompts = listSystemPrompts();
  const activeSystemPrompt =
    allSystemPrompts.find((sp) => sp.id === settings.activeSystemPromptId) ??
    allSystemPrompts[0];

  const allMessages = listRoomMessages(roomId);
  const filteredMessages = allMessages.filter((m) => {
    if (
      options?.beforeSequenceNumber !== undefined &&
      m.sequenceNumber >= options.beforeSequenceNumber
    ) {
      return false;
    }
    if (m.status === 'streaming') return false;
    return m.content.trim().length > 0;
  });

  const windowedMessages = filteredMessages.slice(-room.contextWindowLimit);

  // Scan recent messages + scenario for Lorebook keyword triggers
  let activeLorebookIds: string[] = [];
  try {
    activeLorebookIds = JSON.parse(room.activeLorebookIdsJson || '[]');
  } catch {
    activeLorebookIds = [];
  }

  const allLorebooks = listLorebooksWithEntries().filter((lb) =>
    activeLorebookIds.includes(lb.id)
  );

  const searchableCorpus = [
    room.scenarioPrompt,
    room.memoryBox,
    ...windowedMessages.slice(-8).map((m) => m.content),
  ]
    .join('\n')
    .toLowerCase();

  const loreAfterScenario: string[] = [];
  const loreBeforeChar: string[] = [];
  const matchedLoreTitles: string[] = [];

  for (const lb of allLorebooks) {
    for (const entry of lb.entries) {
      if (!entry.isEnabled) continue;
      let triggered = entry.isConstant;
      if (!triggered && entry.keywords.trim()) {
        const keys = entry.keywords
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean);
        triggered = keys.some((k) => searchableCorpus.includes(k));
      }
      if (triggered) {
        matchedLoreTitles.push(entry.title);
        const formattedEntry = `[Lore — ${entry.title}]: ${replaceTavernMacros(
          entry.content.trim(),
          targetCharacter.name,
          effectiveUserName
        )}`;
        if (entry.insertionPosition === 'before_char') {
          loreBeforeChar.push(formattedEntry);
        } else {
          loreAfterScenario.push(formattedEntry);
        }
      }
    }
  }

  // Build other participant descriptions
  const otherParticipantsLines: string[] = [
    `- ${effectiveUserName} (Human User)${
      activePersona?.description
        ? `: ${replaceTavernMacros(
            activePersona.description.trim(),
            targetCharacter.name,
            effectiveUserName
          )}`
        : ''
    }`,
  ];

  const participantNames = new Set<string>([effectiveUserName, targetCharacter.name]);

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
    ? `\n### YOUR RELATIONSHIPS IN THIS ROOM\n${replaceTavernMacros(
        rosterEntry.relationshipContext.trim(),
        targetCharacter.name,
        effectiveUserName
      )}`
    : '';

  const speakingStyleSection = targetCharacter.speakingStyle?.trim()
    ? `\nSpeaking Style & Cadence: ${replaceTavernMacros(
        targetCharacter.speakingStyle.trim(),
        targetCharacter.name,
        effectiveUserName
      )}`
    : '';

  const mainDirectiveSection = activeSystemPrompt
    ? `### MAIN ROLEPLAY DIRECTIVE (${activeSystemPrompt.title})\n${replaceTavernMacros(
        activeSystemPrompt.content.trim(),
        targetCharacter.name,
        effectiveUserName
      )}`
    : '';

  const memorySection = room.memoryBox?.trim()
    ? `### SHARED MEMORY & STORY SUMMARY\n${replaceTavernMacros(
        room.memoryBox.trim(),
        targetCharacter.name,
        effectiveUserName
      )}`
    : '';

  const systemPromptContent = [
    mainDirectiveSection,
    `### SCENARIO & SHARED ENVIRONMENT`,
    replaceTavernMacros(
      room.scenarioPrompt.trim() || 'An open multi-character conversation room.',
      targetCharacter.name,
      effectiveUserName
    ),
    loreAfterScenario.length > 0
      ? `### WORLD LORE & CONTEXT\n${loreAfterScenario.join('\n')}`
      : '',
    memorySection,
    loreBeforeChar.length > 0
      ? `### CHARACTER & FACTION LORE\n${loreBeforeChar.join('\n')}`
      : '',
    `### YOUR CHARACTER IDENTITY`,
    `You are ${targetCharacter.name} (${targetCharacter.roleTitle}).`,
    replaceTavernMacros(
      targetCharacter.systemPrompt.trim(),
      targetCharacter.name,
      effectiveUserName
    ),
    speakingStyleSection,
    relationshipSection,
    `### OTHER PARTICIPANTS IN THIS ROOM`,
    otherParticipantsLines.join('\n'),
    `### STRICT MULTI-CHARACTER RULES`,
    `1. Stay 100% in character as ${targetCharacter.name}.`,
    `2. Respond directly to the latest developments in the transcript.`,
    `3. NEVER write dialogue, thoughts, or actions on behalf of ${effectiveUserName} or any other character.`,
    `4. Do NOT prefix your response with "[${targetCharacter.name}]:" or "${targetCharacter.name}:". Output your dialogue and actions directly.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const apiMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPromptContent,
    },
  ];

  // Target-Perspective Transcript Remapping
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
      const speakerLabel =
        msg.senderType === 'user'
          ? effectiveUserName
          : msg.senderNameSnapshot || 'Participant';
      participantNames.add(speakerLabel);
      apiMessages.push({
        role: 'user',
        name: sanitizeOpenAIName(speakerLabel),
        content: `[${speakerLabel}]: ${stripLeadingSpeakerPrefix(msg.content, speakerLabel)}`,
      });
    }
  }

  // Post-history anchor
  const addressInstruction = options?.directAddressTo?.trim()
    ? ` Address your dialogue, observation, or question directly to ${options.directAddressTo.trim()}.`
    : '';

  apiMessages.push({
    role: 'system',
    content: `[System Directive]: Now respond strictly as ${targetCharacter.name}.${
      targetCharacter.speakingStyle ? ` Maintain style: ${targetCharacter.speakingStyle}` : ''
    }${addressInstruction} Do not prefix your message with your name and do not write turns for any other participant.`,
  });

  const stopSequences: string[] = [];
  for (const name of participantNames) {
    if (!name) continue;
    stopSequences.push(`\n[${name}]:`);
    stopSequences.push(`\n${name}:`);
    if (stopSequences.length >= 4) break;
  }

  // Model & Sampler resolution (Use Tavern shared settings unless character explicitly overrides)
  const useCharOverride = Boolean(targetCharacter.overrideModelTuning);
  const resolvedModel = useCharOverride
    ? targetCharacter.modelId || settings.defaultModel
    : settings.defaultModel || targetCharacter.modelId;
  const resolvedTemp =
    options?.temperatureOverride ??
    (useCharOverride ? targetCharacter.temperature : settings.temperature);
  const resolvedMaxTokens = useCharOverride
    ? targetCharacter.maxTokens
    : settings.maxTokens;

  return {
    targetCharacter,
    model: resolvedModel,
    temperature: resolvedTemp,
    maxTokens: resolvedMaxTokens,
    topP: settings.topP,
    topK: settings.topK,
    minP: settings.minP,
    repetitionPenalty: settings.repetitionPenalty,
    frequencyPenalty: settings.frequencyPenalty,
    presencePenalty: settings.presencePenalty,
    stopSequences: stopSequences.slice(0, 4),
    matchedLoreTitles,
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
