import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ulid } from 'ulid';
import type {
  Character,
  Room,
  RoomCharacter,
  Message,
  MessageVersion,
  RoomQueueState,
  LlmSettings,
} from './schema';

const DB_PATH = path.join(process.cwd(), 'multichat.db');

declare global {
  // eslint-disable-next-line no-var
  var __sqliteDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __avatarMigrated: boolean | undefined;
}

function ensureAvatarUrlColumn(db: DatabaseSync) {
  if (global.__avatarMigrated) return;
  const cols = db.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>;
  const hasAvatarUrl = cols.some((c) => c.name === 'avatar_url');
  if (!hasAvatarUrl && cols.length > 0) {
    db.exec('ALTER TABLE characters ADD COLUMN avatar_url TEXT;');
  }
  global.__avatarMigrated = true;
}

function getRawDb(): DatabaseSync {
  if (!global.__sqliteDb) {
    const db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA synchronous = NORMAL;');
    initSchemaAndSeed(db);
    global.__sqliteDb = db;
  }
  ensureAvatarUrlColumn(global.__sqliteDb);
  return global.__sqliteDb;
}

function initSchemaAndSeed(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_title TEXT NOT NULL DEFAULT 'Character',
      avatar_color TEXT NOT NULL DEFAULT '#6366f1',
      avatar_url TEXT,
      system_prompt TEXT NOT NULL,
      speaking_style TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      temperature REAL NOT NULL DEFAULT 0.75,
      max_tokens INTEGER NOT NULL DEFAULT 500,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scenario_prompt TEXT NOT NULL DEFAULT '',
      user_display_name TEXT NOT NULL DEFAULT 'Director',
      turn_strategy TEXT NOT NULL DEFAULT 'round_robin',
      cooldown_ms INTEGER NOT NULL DEFAULT 3000,
      max_auto_turns INTEGER NOT NULL DEFAULT 8,
      context_window_limit INTEGER NOT NULL DEFAULT 30,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_characters (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      turn_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      relationship_context TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (room_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_room_turn_order ON room_characters(room_id, turn_order);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      sender_name_snapshot TEXT NOT NULL,
      content TEXT NOT NULL,
      original_content TEXT,
      is_edited INTEGER NOT NULL DEFAULT 0,
      active_version_index INTEGER NOT NULL DEFAULT 1,
      version_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'completed',
      sequence_number INTEGER NOT NULL,
      prompt_debug_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, sequence_number);

    CREATE TABLE IF NOT EXISTS message_versions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      version_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_message_versions ON message_versions(message_id, version_index);

    CREATE TABLE IF NOT EXISTS room_queue_states (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      execution_state TEXT NOT NULL DEFAULT 'IDLE',
      active_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      next_character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
      consecutive_auto_turns INTEGER NOT NULL DEFAULT 0,
      queued_character_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS llm_settings (
      id TEXT PRIMARY KEY,
      base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      api_key TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      use_mock_fallback INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
  `);

  ensureAvatarUrlColumn(db);

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM characters').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const now = Date.now();
    const charSherlock = 'char_sherlock_01';
    const charWatson = 'char_watson_02';
    const charIrene = 'char_irene_03';
    const charKaelen = 'char_kaelen_04';

    const insertChar = db.prepare(`
      INSERT INTO characters (id, name, role_title, avatar_color, avatar_url, system_prompt, speaking_style, model_id, temperature, max_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertChar.run(
      charSherlock,
      'Sherlock Holmes',
      'Consulting Detective',
      '#6366f1',
      null,
      'You are Sherlock Holmes, the world-renowned consulting detective of 221B Baker Street. You possess razor-sharp deductive reasoning, hyper-observant forensic instincts, and an impatience for slow thinking. You dissect small physical clues, behavioral tells, and logical contradictions immediately.',
      'Crisp, incisive, analytical Victorian cadence. Uses brief italicized physical actions (*steeples fingers*, *paces toward the hearth*). Never overly sentimental; prefers cold deduction.',
      process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
      0.7,
      450,
      now
    );

    insertChar.run(
      charWatson,
      'Dr. John Watson',
      'Army Surgeon & Chronicler',
      '#10b981',
      null,
      'You are Dr. John Watson, former British Army surgeon and Sherlock Holmes’s trusted partner and flatmate. You bring medical expertise, practical human empathy, and grounded skepticism when Sherlock leaps to dramatic conclusions.',
      'Warm, pragmatic, grounded British tone. Often asks the practical question the reader is thinking, notices medical or emotional details, and pushes back gently when Sherlock becomes arrogant.',
      process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
      0.7,
      450,
      now
    );

    insertChar.run(
      charIrene,
      'Irene Adler',
      'Strategic Contralto & Broker',
      '#f43f5e',
      null,
      'You are Irene Adler—witty, composed, and always three moves ahead. You treat high-stakes mysteries as a game of leverage and psychology. You enjoy teasing Sherlock’s blind spots while respecting Watson’s loyalty.',
      'Playful, razor-sharp, poised, slightly enigmatic. Speaks with effortless confidence and subtle irony.',
      process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
      0.8,
      450,
      now
    );

    insertChar.run(
      charKaelen,
      'Chief Engineer Vance',
      'Orbital Systems Architect',
      '#f59e0b',
      null,
      'You are Chief Engineer Kaelen Vance aboard Deep Space Relay Helios-9. You care about hull integrity, reactor thermals, and hard telemetry. You distrust corporate cover-ups.',
      'Terse, technical, dry humor under pressure. Cites sensor readings and hard physical constraints.',
      process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
      0.75,
      450,
      now
    );

    const room1 = 'room_baker_street_01';
    db.prepare(`
      INSERT INTO rooms (id, title, scenario_prompt, user_display_name, turn_strategy, cooldown_ms, max_auto_turns, context_window_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      room1,
      '221B Baker Street: The Midnight Cipher',
      'Rain lashes against the tall windows of 221B Baker Street at 1:15 AM. On the center table lies an unsealed brass cylinder containing a charred naval cipher and a fresh white camellia. All participants are gathered around the table trying to determine who sent it and whether it is a trap.',
      'Inspector',
      'round_robin',
      3000,
      8,
      30,
      now,
      now
    );

    const insertRoster = db.prepare(`
      INSERT INTO room_characters (room_id, character_id, turn_order, is_active, relationship_context)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertRoster.run(
      room1,
      charSherlock,
      0,
      1,
      'Longtime partner to Dr. Watson; deeply intrigued and wary of Irene Adler, whom he refers to as "The Woman".'
    );
    insertRoster.run(
      room1,
      charWatson,
      1,
      1,
      'Loyal friend and flatmate to Sherlock Holmes; polite but protective of Sherlock around Irene Adler.'
    );
    insertRoster.run(
      room1,
      charIrene,
      2,
      1,
      'Finds Sherlock endlessly entertaining to outmaneuver; appreciates Dr. Watson’s candor and chivalry.'
    );

    db.prepare(`
      INSERT INTO room_queue_states (room_id, execution_state, active_character_id, next_character_id, consecutive_auto_turns, queued_character_ids_json, updated_at)
      VALUES (?, 'IDLE', NULL, ?, 0, '[]', ?)
    `).run(room1, charSherlock, now);

    // Seed initial messages + version history
    const msg1Id = ulid();
    const msg2Id = ulid();
    const insertMsg = db.prepare(`
      INSERT INTO messages (id, room_id, sender_type, character_id, sender_name_snapshot, content, original_content, is_edited, active_version_index, version_count, status, sequence_number, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 1, 1, 'completed', ?, ?, ?)
    `);
    const insertVer = db.prepare(`
      INSERT INTO message_versions (id, message_id, version_index, content, status, created_at)
      VALUES (?, ?, 1, ?, 'completed', ?)
    `);

    const msg1Text =
      '*sets the brass cylinder onto the blotter with forceps and tilts the magnifying glass over the wax seal* Notice the striations along the rim, Watson. This cylinder was not dropped by a street courier—it was fired through a pneumatic dispatch tube from Whitehall within the last forty minutes.';
    insertMsg.run(msg1Id, room1, 'character', charSherlock, 'Sherlock Holmes', msg1Text, 1, now - 20000, now - 20000);
    insertVer.run(ulid(), msg1Id, msg1Text, now - 20000);

    const msg2Text =
      '*leans over the table, frowning at the charred parchment* Whitehall? At one in the morning? Holmes, half the cipher is burned away—and why on earth would the sender tuck a fresh white camellia beside an Admiralty code?';
    insertMsg.run(msg2Id, room1, 'character', charWatson, 'Dr. John Watson', msg2Text, 2, now - 10000, now - 10000);
    insertVer.run(ulid(), msg2Id, msg2Text, now - 10000);
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM llm_settings').get() as { cnt: number };
  if (settingsCount.cnt === 0) {
    db.prepare(`
      INSERT INTO llm_settings (id, base_url, api_key, default_model, use_mock_fallback, updated_at)
      VALUES ('default', ?, ?, ?, 1, ?)
    `).run(
      process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini',
      Date.now()
    );
  }
}

// Row mappers (snake_case SQLite -> camelCase TypeScript)
function mapCharacter(row: Record<string, unknown>): Character {
  return {
    id: String(row.id),
    name: String(row.name),
    roleTitle: String(row.role_title ?? 'Character'),
    avatarColor: String(row.avatar_color ?? '#6366f1'),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    systemPrompt: String(row.system_prompt),
    speakingStyle: String(row.speaking_style ?? ''),
    modelId: String(row.model_id ?? 'gpt-4o-mini'),
    temperature: Number(row.temperature ?? 0.75),
    maxTokens: Number(row.max_tokens ?? 500),
    createdAt: Number(row.created_at),
  };
}

function mapRoom(row: Record<string, unknown>): Room {
  return {
    id: String(row.id),
    title: String(row.title),
    scenarioPrompt: String(row.scenario_prompt ?? ''),
    userDisplayName: String(row.user_display_name ?? 'Director'),
    turnStrategy: (row.turn_strategy as Room['turnStrategy']) ?? 'round_robin',
    cooldownMs: Number(row.cooldown_ms ?? 3000),
    maxAutoTurns: Number(row.max_auto_turns ?? 8),
    contextWindowLimit: Number(row.context_window_limit ?? 30),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    senderType: row.sender_type as Message['senderType'],
    characterId: row.character_id ? String(row.character_id) : null,
    senderNameSnapshot: String(row.sender_name_snapshot),
    content: String(row.content),
    originalContent: row.original_content !== null && row.original_content !== undefined ? String(row.original_content) : null,
    isEdited: Boolean(row.is_edited),
    activeVersionIndex: Number(row.active_version_index ?? 1),
    versionCount: Number(row.version_count ?? 1),
    status: (row.status as Message['status']) ?? 'completed',
    sequenceNumber: Number(row.sequence_number),
    promptDebugJson: row.prompt_debug_json ? String(row.prompt_debug_json) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export interface RoomRosterMember extends RoomCharacter {
  character: Character;
}

export interface RoomWithDetails {
  room: Room;
  roster: RoomRosterMember[];
  queueState: RoomQueueState;
}

// ==================== CHARACTERS ====================
export function listCharacters(): Character[] {
  const db = getRawDb();
  const rows = db.prepare('SELECT * FROM characters ORDER BY created_at ASC').all() as Record<string, unknown>[];
  return rows.map(mapCharacter);
}

export function getCharacter(id: string): Character | null {
  const db = getRawDb();
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapCharacter(row) : null;
}

export function createCharacter(input: Omit<Character, 'id' | 'createdAt'>): Character {
  const db = getRawDb();
  const id = `char_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO characters (id, name, role_title, avatar_color, avatar_url, system_prompt, speaking_style, model_id, temperature, max_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.roleTitle,
    input.avatarColor,
    input.avatarUrl ?? null,
    input.systemPrompt,
    input.speakingStyle,
    input.modelId,
    input.temperature,
    input.maxTokens,
    now
  );
  return getCharacter(id)!;
}

export function updateCharacter(id: string, input: Partial<Omit<Character, 'id' | 'createdAt'>>): Character | null {
  const existing = getCharacter(id);
  if (!existing) return null;
  const updated = { ...existing, ...input };
  const db = getRawDb();
  db.prepare(`
    UPDATE characters
    SET name = ?, role_title = ?, avatar_color = ?, avatar_url = ?, system_prompt = ?, speaking_style = ?, model_id = ?, temperature = ?, max_tokens = ?
    WHERE id = ?
  `).run(
    updated.name,
    updated.roleTitle,
    updated.avatarColor,
    updated.avatarUrl ?? null,
    updated.systemPrompt,
    updated.speakingStyle,
    updated.modelId,
    updated.temperature,
    updated.maxTokens,
    id
  );
  return getCharacter(id);
}

export function deleteCharacter(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM characters WHERE id = ?').run(id);
}

// ==================== ROOMS & ROSTER ====================
export function listRooms(): Room[] {
  const db = getRawDb();
  const rows = db.prepare('SELECT * FROM rooms ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return rows.map(mapRoom);
}

export function getRoomWithDetails(roomId: string): RoomWithDetails | null {
  const db = getRawDb();
  const roomRow = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
  if (!roomRow) return null;
  const room = mapRoom(roomRow);

  const rosterRows = db
    .prepare(`
      SELECT rc.room_id, rc.character_id, rc.turn_order, rc.is_active, rc.relationship_context,
             c.id as c_id, c.name as c_name, c.role_title as c_role_title, c.avatar_color as c_avatar_color,
             c.avatar_url as c_avatar_url,
             c.system_prompt as c_system_prompt, c.speaking_style as c_speaking_style,
             c.model_id as c_model_id, c.temperature as c_temperature, c.max_tokens as c_max_tokens, c.created_at as c_created_at
      FROM room_characters rc
      JOIN characters c ON c.id = rc.character_id
      WHERE rc.room_id = ?
      ORDER BY rc.turn_order ASC
    `)
    .all(roomId) as Record<string, unknown>[];

  const roster: RoomRosterMember[] = rosterRows.map((r) => ({
    roomId: String(r.room_id),
    characterId: String(r.character_id),
    turnOrder: Number(r.turn_order),
    isActive: Boolean(r.is_active),
    relationshipContext: String(r.relationship_context ?? ''),
    character: {
      id: String(r.c_id),
      name: String(r.c_name),
      roleTitle: String(r.c_role_title ?? 'Character'),
      avatarColor: String(r.c_avatar_color ?? '#6366f1'),
      avatarUrl: r.c_avatar_url ? String(r.c_avatar_url) : null,
      systemPrompt: String(r.c_system_prompt),
      speakingStyle: String(r.c_speaking_style ?? ''),
      modelId: String(r.c_model_id ?? 'gpt-4o-mini'),
      temperature: Number(r.c_temperature ?? 0.75),
      maxTokens: Number(r.c_max_tokens ?? 500),
      createdAt: Number(r.c_created_at),
    },
  }));

  let queueRow = db.prepare('SELECT * FROM room_queue_states WHERE room_id = ?').get(roomId) as
    | Record<string, unknown>
    | undefined;

  if (!queueRow) {
    const firstChar = roster.find((m) => m.isActive)?.characterId ?? null;
    const now = Date.now();
    db.prepare(`
      INSERT INTO room_queue_states (room_id, execution_state, active_character_id, next_character_id, consecutive_auto_turns, queued_character_ids_json, updated_at)
      VALUES (?, 'IDLE', NULL, ?, 0, '[]', ?)
    `).run(roomId, firstChar, now);
    queueRow = db.prepare('SELECT * FROM room_queue_states WHERE room_id = ?').get(roomId) as Record<string, unknown>;
  }

  const queueState: RoomQueueState = {
    roomId: String(queueRow.room_id),
    executionState: (queueRow.execution_state as RoomQueueState['executionState']) ?? 'IDLE',
    activeCharacterId: queueRow.active_character_id ? String(queueRow.active_character_id) : null,
    nextCharacterId: queueRow.next_character_id ? String(queueRow.next_character_id) : null,
    consecutiveAutoTurns: Number(queueRow.consecutive_auto_turns ?? 0),
    queuedCharacterIdsJson: String(queueRow.queued_character_ids_json ?? '[]'),
    updatedAt: Number(queueRow.updated_at),
  };

  return { room, roster, queueState };
}

export function createRoom(input: {
  title: string;
  scenarioPrompt?: string;
  userDisplayName?: string;
  turnStrategy?: Room['turnStrategy'];
  cooldownMs?: number;
  maxAutoTurns?: number;
  contextWindowLimit?: number;
  roster?: Array<{ characterId: string; relationshipContext?: string }>;
}): RoomWithDetails {
  const db = getRawDb();
  const roomId = `room_${ulid().toLowerCase()}`;
  const now = Date.now();

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      INSERT INTO rooms (id, title, scenario_prompt, user_display_name, turn_strategy, cooldown_ms, max_auto_turns, context_window_limit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      roomId,
      input.title,
      input.scenarioPrompt ?? '',
      input.userDisplayName ?? 'Director',
      input.turnStrategy ?? 'round_robin',
      input.cooldownMs ?? 3000,
      input.maxAutoTurns ?? 8,
      input.contextWindowLimit ?? 30,
      now,
      now
    );

    const rosterItems = input.roster ?? [];
    const insertRoster = db.prepare(`
      INSERT INTO room_characters (room_id, character_id, turn_order, is_active, relationship_context)
      VALUES (?, ?, ?, 1, ?)
    `);
    rosterItems.forEach((item, idx) => {
      insertRoster.run(roomId, item.characterId, idx, item.relationshipContext ?? '');
    });

    const firstCharId = rosterItems[0]?.characterId ?? null;
    db.prepare(`
      INSERT INTO room_queue_states (room_id, execution_state, active_character_id, next_character_id, consecutive_auto_turns, queued_character_ids_json, updated_at)
      VALUES (?, 'IDLE', NULL, ?, 0, '[]', ?)
    `).run(roomId, firstCharId, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getRoomWithDetails(roomId)!;
}

export function updateRoom(
  roomId: string,
  input: Partial<Omit<Room, 'id' | 'createdAt' | 'updatedAt'>> & {
    roster?: Array<{ characterId: string; isActive?: boolean; relationshipContext?: string }>;
  }
): RoomWithDetails | null {
  const existing = getRoomWithDetails(roomId);
  if (!existing) return null;
  const db = getRawDb();
  const now = Date.now();
  const r = { ...existing.room, ...input };

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE rooms
      SET title = ?, scenario_prompt = ?, user_display_name = ?, turn_strategy = ?,
          cooldown_ms = ?, max_auto_turns = ?, context_window_limit = ?, updated_at = ?
      WHERE id = ?
    `).run(
      r.title,
      r.scenarioPrompt,
      r.userDisplayName,
      r.turnStrategy,
      r.cooldownMs,
      r.maxAutoTurns,
      r.contextWindowLimit,
      now,
      roomId
    );

    if (input.roster) {
      db.prepare('DELETE FROM room_characters WHERE room_id = ?').run(roomId);
      const insertRoster = db.prepare(`
        INSERT INTO room_characters (room_id, character_id, turn_order, is_active, relationship_context)
        VALUES (?, ?, ?, ?, ?)
      `);
      input.roster.forEach((item, idx) => {
        insertRoster.run(roomId, item.characterId, idx, item.isActive === false ? 0 : 1, item.relationshipContext ?? '');
      });
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getRoomWithDetails(roomId);
}

export function deleteRoom(roomId: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
}

// ==================== MESSAGES, INLINE EDITS & REGENERATION ====================
export interface MessageWithVersions extends Message {
  versions: MessageVersion[];
}

export function listRoomMessages(roomId: string): MessageWithVersions[] {
  const db = getRawDb();
  const rows = db
    .prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY sequence_number ASC')
    .all(roomId) as Record<string, unknown>[];

  const messagesList = rows.map(mapMessage);
  if (messagesList.length === 0) return [];

  const versionRows = db
    .prepare(`
      SELECT mv.*
      FROM message_versions mv
      JOIN messages m ON m.id = mv.message_id
      WHERE m.room_id = ?
      ORDER BY mv.version_index ASC
    `)
    .all(roomId) as Record<string, unknown>[];

  const versionsByMsg = new Map<string, MessageVersion[]>();
  for (const vr of versionRows) {
    const mv: MessageVersion = {
      id: String(vr.id),
      messageId: String(vr.message_id),
      versionIndex: Number(vr.version_index),
      content: String(vr.content),
      status: (vr.status as MessageVersion['status']) ?? 'completed',
      createdAt: Number(vr.created_at),
    };
    const arr = versionsByMsg.get(mv.messageId) ?? [];
    arr.push(mv);
    versionsByMsg.set(mv.messageId, arr);
  }

  return messagesList.map((m) => ({
    ...m,
    versions: versionsByMsg.get(m.id) ?? [
      {
        id: `ver_fallback_${m.id}`,
        messageId: m.id,
        versionIndex: 1,
        content: m.content,
        status: m.status === 'streaming' ? 'completed' : m.status,
        createdAt: m.createdAt,
      },
    ],
  }));
}

export function getMessageById(messageId: string): MessageWithVersions | null {
  const db = getRawDb();
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const msg = mapMessage(row);
  const vRows = db
    .prepare('SELECT * FROM message_versions WHERE message_id = ? ORDER BY version_index ASC')
    .all(messageId) as Record<string, unknown>[];
  return {
    ...msg,
    versions: vRows.map((vr) => ({
      id: String(vr.id),
      messageId: String(vr.message_id),
      versionIndex: Number(vr.version_index),
      content: String(vr.content),
      status: (vr.status as MessageVersion['status']) ?? 'completed',
      createdAt: Number(vr.created_at),
    })),
  };
}

export function createMessage(input: {
  roomId: string;
  senderType: Message['senderType'];
  characterId?: string | null;
  senderNameSnapshot: string;
  content: string;
  status?: Message['status'];
  promptDebugJson?: string | null;
}): MessageWithVersions {
  const db = getRawDb();
  const id = ulid();
  const now = Date.now();
  const status = input.status ?? 'completed';

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const seqRow = db
      .prepare('SELECT COALESCE(MAX(sequence_number), 0) as max_seq FROM messages WHERE room_id = ?')
      .get(input.roomId) as { max_seq: number };
    const nextSeq = seqRow.max_seq + 1;

    db.prepare(`
      INSERT INTO messages (
        id, room_id, sender_type, character_id, sender_name_snapshot,
        content, original_content, is_edited, active_version_index, version_count,
        status, sequence_number, prompt_debug_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 1, 1, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.roomId,
      input.senderType,
      input.characterId ?? null,
      input.senderNameSnapshot,
      input.content,
      status,
      nextSeq,
      input.promptDebugJson ?? null,
      now,
      now
    );

    if (status !== 'streaming') {
      db.prepare(`
        INSERT INTO message_versions (id, message_id, version_index, content, status, created_at)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(ulid(), id, input.content, status, now);
    }

    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(now, input.roomId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getMessageById(id)!;
}

export function finalizeStreamedMessage(
  messageId: string,
  content: string,
  status: 'completed' | 'aborted' | 'error',
  promptDebugJson?: string | null
): MessageWithVersions | null {
  const db = getRawDb();
  const existing = getMessageById(messageId);
  if (!existing) return null;
  const now = Date.now();

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE messages
      SET content = ?, status = ?, prompt_debug_json = COALESCE(?, prompt_debug_json), updated_at = ?
      WHERE id = ?
    `).run(content, status, promptDebugJson ?? null, now, messageId);

    const existingVer = db
      .prepare('SELECT id FROM message_versions WHERE message_id = ? AND version_index = ?')
      .get(messageId, existing.activeVersionIndex) as { id: string } | undefined;

    if (existingVer) {
      db.prepare('UPDATE message_versions SET content = ?, status = ? WHERE id = ?').run(
        content,
        status,
        existingVer.id
      );
    } else {
      db.prepare(`
        INSERT INTO message_versions (id, message_id, version_index, content, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(ulid(), messageId, existing.activeVersionIndex, content, status, now);
    }

    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(now, existing.roomId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getMessageById(messageId);
}

export function editMessageInline(messageId: string, newContent: string): MessageWithVersions | null {
  const db = getRawDb();
  const existing = getMessageById(messageId);
  if (!existing) return null;
  const now = Date.now();
  const originalContent = existing.isEdited ? existing.originalContent : existing.content;

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE messages
      SET content = ?, original_content = ?, is_edited = 1, status = 'completed', updated_at = ?
      WHERE id = ?
    `).run(newContent, originalContent, now, messageId);

    const verRow = db
      .prepare('SELECT id FROM message_versions WHERE message_id = ? AND version_index = ?')
      .get(messageId, existing.activeVersionIndex) as { id: string } | undefined;

    if (verRow) {
      db.prepare('UPDATE message_versions SET content = ? WHERE id = ?').run(newContent, verRow.id);
    } else {
      db.prepare(`
        INSERT INTO message_versions (id, message_id, version_index, content, status, created_at)
        VALUES (?, ?, ?, ?, 'completed', ?)
      `).run(ulid(), messageId, existing.activeVersionIndex, newContent, now);
    }

    db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?').run(now, existing.roomId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getMessageById(messageId);
}

export function prepareMessageRegeneration(
  messageId: string,
  truncateSubsequent: boolean
): { message: MessageWithVersions; deletedCount: number } | null {
  const db = getRawDb();
  const existing = getMessageById(messageId);
  if (!existing) return null;
  const now = Date.now();
  let deletedCount = 0;

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const curVer = db
      .prepare('SELECT id FROM message_versions WHERE message_id = ? AND version_index = ?')
      .get(messageId, existing.activeVersionIndex) as { id: string } | undefined;

    if (!curVer && existing.content.trim().length > 0) {
      db.prepare(`
        INSERT INTO message_versions (id, message_id, version_index, content, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        ulid(),
        messageId,
        existing.activeVersionIndex,
        existing.content,
        existing.status === 'streaming' ? 'aborted' : existing.status,
        now
      );
    }

    if (truncateSubsequent) {
      const delRes = db
        .prepare('DELETE FROM messages WHERE room_id = ? AND sequence_number > ?')
        .run(existing.roomId, existing.sequenceNumber);
      deletedCount = Number(delRes.changes ?? 0);
    }

    const nextVerIndex = existing.versionCount + 1;
    db.prepare(`
      UPDATE messages
      SET content = '', status = 'streaming', active_version_index = ?, version_count = ?, updated_at = ?
      WHERE id = ?
    `).run(nextVerIndex, nextVerIndex, now, messageId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { message: getMessageById(messageId)!, deletedCount };
}

export function switchMessageVersion(messageId: string, targetVersionIndex: number): MessageWithVersions | null {
  const db = getRawDb();
  const existing = getMessageById(messageId);
  if (!existing) return null;

  const targetVer = existing.versions.find((v) => v.versionIndex === targetVersionIndex);
  if (!targetVer) return null;

  const now = Date.now();
  db.prepare(`
    UPDATE messages
    SET content = ?, active_version_index = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(targetVer.content, targetVer.versionIndex, targetVer.status, now, messageId);

  return getMessageById(messageId);
}

export function deleteMessage(messageId: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
}

// ==================== QUEUE STATE ====================
export function updateRoomQueueState(
  roomId: string,
  patch: Partial<Omit<RoomQueueState, 'roomId' | 'updatedAt'>>
): RoomQueueState {
  const db = getRawDb();
  const details = getRoomWithDetails(roomId);
  if (!details) throw new Error(`Room ${roomId} not found`);
  const cur = details.queueState;
  const next = { ...cur, ...patch, updatedAt: Date.now() };

  db.prepare(`
    UPDATE room_queue_states
    SET execution_state = ?, active_character_id = ?, next_character_id = ?,
        consecutive_auto_turns = ?, queued_character_ids_json = ?, updated_at = ?
    WHERE room_id = ?
  `).run(
    next.executionState,
    next.activeCharacterId,
    next.nextCharacterId,
    next.consecutiveAutoTurns,
    next.queuedCharacterIdsJson,
    next.updatedAt,
    roomId
  );

  return next;
}

// ==================== LLM SETTINGS ====================
export function getLlmSettings(): LlmSettings {
  const db = getRawDb();
  const row = db.prepare("SELECT * FROM llm_settings WHERE id = 'default'").get() as Record<string, unknown>;
  return {
    id: 'default',
    baseUrl: String(row.base_url || process.env.LLM_BASE_URL || 'https://api.openai.com/v1'),
    apiKey: String(row.api_key || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''),
    defaultModel: String(row.default_model || process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini'),
    useMockFallback: Boolean(row.use_mock_fallback),
    updatedAt: Number(row.updated_at),
  };
}

export function updateLlmSettings(patch: Partial<Omit<LlmSettings, 'id' | 'updatedAt'>>): LlmSettings {
  const db = getRawDb();
  const cur = getLlmSettings();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  db.prepare(`
    UPDATE llm_settings
    SET base_url = ?, api_key = ?, default_model = ?, use_mock_fallback = ?, updated_at = ?
    WHERE id = 'default'
  `).run(next.baseUrl, next.apiKey, next.defaultModel, next.useMockFallback ? 1 : 0, next.updatedAt);
  return getLlmSettings();
}
