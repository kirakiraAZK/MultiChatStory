import { getRoomWithDetails, listRoomMessages, type RoomRosterMember } from '@/lib/db';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts character IDs that were explicitly @mentioned in a message text,
 * ordered by their first appearance in the text.
 * Supports @Full Name, @Full_Name, @FirstName, or @LastName.
 */
export function extractMentionedCharacterIds(
  text: string,
  roster: RoomRosterMember[],
  excludeCharacterId?: string | null
): string[] {
  if (!text || !text.includes('@')) return [];

  const activeCandidates = roster.filter(
    (r) => r.isActive && r.characterId !== excludeCharacterId
  );
  if (activeCandidates.length === 0) return [];

  const matches: Array<{ characterId: string; index: number }> = [];

  for (const member of activeCandidates) {
    const rawName = member.character.name.trim();
    if (!rawName) continue;

    const parts = rawName.split(/\s+/).filter(Boolean);
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts[parts.length - 1] : null;
    const underscored = rawName.replace(/\s+/g, '_');

    const patterns = [
      escapeRegex(rawName),
      escapeRegex(underscored),
      ...(firstName && firstName.length >= 2 ? [escapeRegex(firstName)] : []),
      ...(lastName && lastName.length >= 3 ? [escapeRegex(lastName)] : []),
    ];

    const regex = new RegExp(`@(?:${patterns.join('|')})(?![a-zA-Z0-9_])`, 'i');
    const match = regex.exec(text);
    if (match && match.index !== undefined) {
      matches.push({ characterId: member.characterId, index: match.index });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return Array.from(new Set(matches.map((m) => m.characterId)));
}

export function resolveNextCharacterId(
  roomId: string,
  options?: {
    preferredCharacterId?: string | null;
    excludeCharacterId?: string | null;
  }
): string | null {
  const details = getRoomWithDetails(roomId);
  if (!details) return null;

  const activeRoster = details.roster.filter((r) => r.isActive);
  if (activeRoster.length === 0) return null;

  // 1. Explicit manual target override
  if (options?.preferredCharacterId) {
    const found = details.roster.find((r) => r.characterId === options.preferredCharacterId);
    if (found) return found.characterId;
  }

  // 2. Check explicit queue in roomQueueStates (e.g. multi-@mention queue)
  try {
    const queued: string[] = JSON.parse(details.queueState.queuedCharacterIdsJson || '[]');
    if (queued.length > 0) {
      const nextQueued = queued.find(
        (id) =>
          id !== options?.excludeCharacterId &&
          activeRoster.some((r) => r.characterId === id)
      );
      if (nextQueued) return nextQueued;
    }
  } catch {
    // Ignore malformed JSON
  }

  const messages = listRoomMessages(roomId).filter((m) => m.content.trim().length > 0);
  const lastMessage = messages[messages.length - 1];
  const lastSpeakerCharId =
    options?.excludeCharacterId ??
    (lastMessage?.senderType === 'character' ? lastMessage.characterId : null);

  // 3. Explicit @Character Mention in the latest message (Always highest priority across all strategies)
  if (lastMessage) {
    const mentionedIds = extractMentionedCharacterIds(
      lastMessage.content,
      activeRoster,
      lastSpeakerCharId
    );
    if (mentionedIds.length > 0) {
      return mentionedIds[0];
    }
  }

  // 4. Dynamic Router Strategy: check if the last message directly addresses a specific active character by name
  if (details.room.turnStrategy === 'dynamic_router' && lastMessage) {
    const lowerText = lastMessage.content.toLowerCase();
    const candidates = activeRoster.filter((r) => r.characterId !== lastSpeakerCharId);
    for (const candidate of candidates) {
      const fullName = candidate.character.name.toLowerCase();
      const firstName = fullName.split(' ')[0];
      const lastName = fullName.split(' ').slice(-1)[0];
      if (
        lowerText.includes(fullName) ||
        (firstName && firstName.length > 2 && lowerText.includes(firstName)) ||
        (lastName && lastName.length > 2 && lowerText.includes(lastName))
      ) {
        return candidate.characterId;
      }
    }
  }

  // 5. Round-Robin Strategy (default & fallback)
  if (!lastSpeakerCharId) {
    return activeRoster[0].characterId;
  }

  const lastIdx = activeRoster.findIndex((r) => r.characterId === lastSpeakerCharId);
  if (lastIdx === -1) {
    return activeRoster[0].characterId;
  }

  const nextIdx = (lastIdx + 1) % activeRoster.length;
  return activeRoster[nextIdx].characterId;
}
