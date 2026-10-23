import { ulid } from 'ulid';
import { getRoomWithDetails, parseRoomSubPlaces, updateRoom, type RoomWithDetails } from '@/lib/db';
import type { RoomSubPlace, TimeOfDay } from '@/lib/db/schema';

export interface NarrationEnvironmentTransition {
  changed: boolean;
  locationChanged: boolean;
  timeChanged: boolean;
  createdNewSubPlace: boolean;
  placeName: string;
  subPlace: RoomSubPlace | null;
  timeOfDay: TimeOfDay;
  customTimeLabel: string;
  updatedRoomDetails: RoomWithDetails | null;
}

const TIME_PATTERNS: Array<{ time: TimeOfDay; regex: RegExp }> = [
  {
    time: 'midnight',
    regex:
      /\b(?:at\s+midnight|around\s+midnight|by\s+midnight|past\s+midnight|late\s+at\s+night|in\s+the\s+dead\s+of\s+night|it(?:'s|\s+is)\s+midnight)\b/i,
  },
  {
    time: 'dawn',
    regex:
      /\b(?:at\s+dawn|at\s+sunrise|at\s+daybreak|by\s+dawn|early\s+in\s+the\s+morning|as\s+the\s+sun\s+rises|it(?:'s|\s+is)\s+dawn)\b/i,
  },
  {
    time: 'morning',
    regex:
      /\b(?:in\s+the\s+morning|the\s+next\s+morning|this\s+morning|by\s+morning|at\s+morning|morning\s+comes|it(?:'s|\s+is)\s+morning)\b/i,
  },
  {
    time: 'noon',
    regex:
      /\b(?:at\s+noon|at\s+midday|in\s+the\s+afternoon|by\s+noon|by\s+afternoon|during\s+the\s+day|it(?:'s|\s+is)\s+(?:noon|midday|afternoon))\b/i,
  },
  {
    time: 'sunset',
    regex:
      /\b(?:at\s+sunset|at\s+dusk|at\s+twilight|in\s+the\s+evening|this\s+evening|by\s+evening|as\s+the\s+sun\s+sets|at\s+sundown|it(?:'s|\s+is)\s+(?:sunset|dusk|evening))\b/i,
  },
  {
    time: 'night',
    regex:
      /\b(?:at\s+night|in\s+the\s+night|by\s+night|later\s+that\s+night|tonight|when\s+night\s+falls|it(?:'s|\s+is)\s+night(?:time)?)\b/i,
  },
];

const MOVEMENT_VERB_PREFIX =
  '(?:we\\s+|let\'?s\\s+|i\\s+|everyone\\s+|they\\s+|\\*\\s*)?(?:go(?:es|ing)?|walk(?:s|ing)?|head(?:s|ing)?|move(?:s|ing)?|step(?:s|ping)?|enter(?:s|ing)?|travel(?:s|ing)?|return(?:s|ing)?|run(?:s|ning)?|stroll(?:s|ing)?|relocate(?:s|ing)?|proceed(?:s|ing)?)\\s+(?:into|in|to|toward|towards|inside|out\\s+to|over\\s+to|back\\s+to|up\\s+to|down\\s+to)';

const STOP_WORDS_DESTINATION = new Set([
  'bed',
  'sleep',
  'work',
  'talk',
  'speak',
  'chat',
  'eat',
  'drink',
  'see',
  'check',
  'find',
  'look',
  'ask',
  'tell',
  'him',
  'her',
  'them',
  'you',
  'me',
  'us',
  'it',
  'that',
  'this',
  'there',
  'here',
]);

function toTitleCase(str: string): string {
  return str
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (['of', 'the', 'and', 'in', 'on', 'at'].includes(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function cleanExtractedLocationName(raw: string): string {
  // Strip trailing time phrases or punctuation from extracted location
  let cleaned = raw
    .replace(
      /\s+(?:at\s+(?:dawn|sunrise|morning|noon|midday|afternoon|sunset|dusk|twilight|evening|night|midnight)|in\s+the\s+(?:morning|afternoon|evening|night)|tonight|together|now|for\s+a\s+while|to\s+talk|to\s+rest|and\s+.*)$/i,
      ''
    )
    .replace(/^(?:the|a|an|our|my|their)\s+/i, '')
    .replace(/[*_~"`.,!?;:]+$/g, '')
    .trim();

  if (cleaned.length < 2 || cleaned.length > 42) return '';
  if (STOP_WORDS_DESTINATION.has(cleaned.toLowerCase())) return '';
  return toTitleCase(cleaned);
}

export function detectAndApplyEnvironmentFromNarration(
  roomId: string,
  text: string
): NarrationEnvironmentTransition | null {
  const details = getRoomWithDetails(roomId);
  if (!details) return null;

  const { room } = details;
  const subPlaces = parseRoomSubPlaces(room.subPlacesJson);
  let nextTimeOfDay: TimeOfDay = room.currentTimeOfDay || 'night';
  let nextCustomTimeLabel = room.customTimeLabel || '';
  let nextPlaceName = room.currentPlaceName || 'Main Location';
  let nextSubPlaceId = room.currentSubPlaceId || subPlaces[0]?.id || null;

  let timeChanged = false;
  let locationChanged = false;
  let createdNewSubPlace = false;

  // 1. Detect Time of Day transitions
  for (const candidate of TIME_PATTERNS) {
    if (candidate.regex.test(text)) {
      if (nextTimeOfDay !== candidate.time) {
        nextTimeOfDay = candidate.time;
        nextCustomTimeLabel = '';
        timeChanged = true;
      }
      break;
    }
  }

  // Also check explicit clock patterns like "at 7:30 AM" or "it is 2:00 PM"
  const clockMatch = text.match(
    /\b(?:at|it(?:'s|\s+is)|around|by)\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\b/
  );
  if (clockMatch?.[1]) {
    const clockStr = clockMatch[1].toUpperCase();
    if (nextCustomTimeLabel !== clockStr) {
      nextCustomTimeLabel = clockStr;
      timeChanged = true;
    }
    const hour = parseInt(clockStr.split(':')[0] || '12', 10);
    const isPm = clockStr.includes('PM');
    const hour24 = isPm ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
    let inferredTime: TimeOfDay = 'night';
    if (hour24 >= 0 && hour24 < 5) inferredTime = 'midnight';
    else if (hour24 >= 5 && hour24 < 7) inferredTime = 'dawn';
    else if (hour24 >= 7 && hour24 < 12) inferredTime = 'morning';
    else if (hour24 >= 12 && hour24 < 17) inferredTime = 'noon';
    else if (hour24 >= 17 && hour24 < 20) inferredTime = 'sunset';
    else inferredTime = 'night';

    if (nextTimeOfDay !== inferredTime) {
      nextTimeOfDay = inferredTime;
      timeChanged = true;
    }
  }

  // 2. Detect existing sub-place match in movement context or direct mention
  const lowerText = text.toLowerCase();
  const hasMovementCue = new RegExp(MOVEMENT_VERB_PREFIX, 'i').test(text);

  for (const sp of subPlaces) {
    const spLower = sp.name.toLowerCase();
    const escapedSp = spLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const directMoveRegex = new RegExp(
      `(?:to|into|inside|in|toward|towards|enter|at)\\s+(?:the\\s+)?${escapedSp}\\b`,
      'i'
    );
    if (directMoveRegex.test(lowerText)) {
      if (nextSubPlaceId !== sp.id) {
        nextSubPlaceId = sp.id;
        if (sp.parentPlaceName) {
          nextPlaceName = sp.parentPlaceName;
        }
        locationChanged = true;
      }
      break;
    }
  }

  // 3. If no existing sub-place matched, check if user narrated moving to a brand-new place/sub-place
  if (!locationChanged && hasMovementCue) {
    const moveExtractRegex = new RegExp(
      `${MOVEMENT_VERB_PREFIX}\\s+(?:the\\s+|a\\s+|an\\s+|our\\s+|my\\s+)?([a-zA-Z0-9'\\s-]{2,36}?)(?:\\s+(?:at|in|during|by|where|with|and|to)\\b|[.,!?;:*]|$)`,
      'i'
    );
    const match = text.match(moveExtractRegex);
    if (match?.[1]) {
      const candidateName = cleanExtractedLocationName(match[1]);
      if (candidateName) {
        const existingMatch = subPlaces.find(
          (sp) => sp.name.toLowerCase() === candidateName.toLowerCase()
        );
        if (existingMatch) {
          if (nextSubPlaceId !== existingMatch.id) {
            nextSubPlaceId = existingMatch.id;
            nextPlaceName = existingMatch.parentPlaceName || nextPlaceName;
            locationChanged = true;
          }
        } else {
          // Determine whether it's an indoor sub-place of the current building or a standalone outdoor/external place
          const indoorKeywords = [
            'room',
            'kitchen',
            'bedroom',
            'bathroom',
            'hallway',
            'corridor',
            'study',
            'library',
            'attic',
            'basement',
            'cellar',
            'balcony',
            'roof',
            'rooftop',
            'garden',
            'courtyard',
            'parlor',
            'lounge',
            'office',
            'lab',
            'laboratory',
            'deck',
            'bridge',
            'quarters',
          ];
          const isSubRoom = indoorKeywords.some((kw) =>
            candidateName.toLowerCase().includes(kw)
          );
          const parentPlace = isSubRoom ? nextPlaceName : candidateName;

          const newSubPlace: RoomSubPlace = {
            id: `subplace_${ulid().toLowerCase()}`,
            name: candidateName,
            parentPlaceName: parentPlace,
            description: isSubRoom
              ? `${candidateName} inside ${parentPlace}.`
              : `${candidateName} scene location.`,
            backgroundsByTime: {},
          };

          subPlaces.push(newSubPlace);
          nextSubPlaceId = newSubPlace.id;
          nextPlaceName = parentPlace;
          locationChanged = true;
          createdNewSubPlace = true;
        }
      }
    }
  }

  if (!timeChanged && !locationChanged) {
    const activeSp =
      subPlaces.find((sp) => sp.id === nextSubPlaceId) ?? subPlaces[0] ?? null;
    return {
      changed: false,
      locationChanged: false,
      timeChanged: false,
      createdNewSubPlace: false,
      placeName: nextPlaceName,
      subPlace: activeSp,
      timeOfDay: nextTimeOfDay,
      customTimeLabel: nextCustomTimeLabel,
      updatedRoomDetails: null,
    };
  }

  const updatedRoomDetails = updateRoom(roomId, {
    currentPlaceName: nextPlaceName,
    currentSubPlaceId: nextSubPlaceId,
    subPlacesJson: JSON.stringify(subPlaces),
    currentTimeOfDay: nextTimeOfDay,
    customTimeLabel: nextCustomTimeLabel,
  });

  const activeSp =
    subPlaces.find((sp) => sp.id === nextSubPlaceId) ?? subPlaces[0] ?? null;

  return {
    changed: true,
    locationChanged,
    timeChanged,
    createdNewSubPlace,
    placeName: nextPlaceName,
    subPlace: activeSp,
    timeOfDay: nextTimeOfDay,
    customTimeLabel: nextCustomTimeLabel,
    updatedRoomDetails,
  };
}
