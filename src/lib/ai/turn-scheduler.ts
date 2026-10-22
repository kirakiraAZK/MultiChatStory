import { getRoomWithDetails, listRoomMessages } from '@/lib/db';

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

  // 2. Check explicit manual queue in roomQueueStates
  try {
    const queued: string[] = JSON.parse(details.queueState.queuedCharacterIdsJson || '[]');
    if (queued.length > 0) {
      const nextQueued = queued.find((id) => activeRoster.some((r) => r.characterId === id));
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

  // 3. Dynamic Router Strategy: check if the last message directly addresses a specific active character by name
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

  // 4. Round-Robin Strategy (default & fallback)
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
