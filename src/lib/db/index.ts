import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ulid } from 'ulid';
import type {
  Character,
  CharacterOutfit,
  Room,
  RoomCharacter,
  Message,
  MessageVersion,
  RoomQueueState,
  LlmSettings,
  SystemPromptPreset,
  SamplerPreset,
  UserPersona,
  Lorebook,
  LorebookEntry,
} from './schema';

const DB_PATH = path.join(process.cwd(), 'multichat.db');

declare global {
  // eslint-disable-next-line no-var
  var __sqliteDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __tavernMigratedV4: boolean | undefined;
}

function ensureColumn(db: DatabaseSync, table: string, colName: string, colDef: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === colName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef};`);
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const cleaned: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      (cleaned as Record<string, unknown>)[k] = v;
    }
  }
  return cleaned;
}

function runTavernMigrationsAndSeed(db: DatabaseSync) {
  if (global.__tavernMigratedV4) return;

  // Migrate existing tables non-destructively
  ensureColumn(db, 'characters', 'avatar_url', 'TEXT');
  ensureColumn(db, 'characters', 'appearance', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'characters', 'outfits_json', "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, 'characters', 'active_outfit_id', 'TEXT');
  ensureColumn(db, 'characters', 'override_model_tuning', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn(db, 'room_characters', 'active_outfit_id', 'TEXT');

  ensureColumn(db, 'rooms', 'memory_box', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'rooms', 'summary_model_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'rooms', 'auto_summarize_interval', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rooms', 'active_lorebook_ids_json', "TEXT NOT NULL DEFAULT '[\"lb_baker_street_01\"]'");

  ensureColumn(db, 'llm_settings', 'temperature', 'REAL NOT NULL DEFAULT 0.75');
  ensureColumn(db, 'llm_settings', 'max_tokens', 'INTEGER NOT NULL DEFAULT 300');
  ensureColumn(db, 'llm_settings', 'top_p', 'REAL NOT NULL DEFAULT 0.92');
  ensureColumn(db, 'llm_settings', 'top_k', 'INTEGER NOT NULL DEFAULT 100');
  ensureColumn(db, 'llm_settings', 'min_p', 'REAL NOT NULL DEFAULT 0.05');
  ensureColumn(db, 'llm_settings', 'repetition_penalty', 'REAL NOT NULL DEFAULT 1.05');
  ensureColumn(db, 'llm_settings', 'frequency_penalty', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'llm_settings', 'presence_penalty', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'llm_settings', 'active_system_prompt_id', "TEXT NOT NULL DEFAULT 'sp_roleplay'");
  ensureColumn(db, 'llm_settings', 'personas_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'llm_settings', 'active_persona_id', "TEXT NOT NULL DEFAULT 'persona_inspector_01'");
  ensureColumn(db, 'llm_settings', 'active_preset_id', 'TEXT');
  ensureColumn(db, 'llm_settings', 'favorite_models_json', "TEXT NOT NULL DEFAULT '[]'");

  // Ensure Tavern tables match v2 schema (drop & recreate if legacy draft columns detected)
  const checkTableHasCol = (table: string, col: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.length === 0 || cols.some((c) => c.name === col);
  };

  if (!checkTableHasCol('sampler_presets', 'title')) {
    db.exec('DROP TABLE IF EXISTS sampler_presets;');
  }
  if (!checkTableHasCol('user_personas', 'name')) {
    db.exec('DROP TABLE IF EXISTS user_personas;');
  }
  if (!checkTableHasCol('lorebooks', 'title') || !checkTableHasCol('lorebook_entries', 'lorebook_id')) {
    db.exec('DROP TABLE IF EXISTS lorebook_entries;');
    db.exec('DROP TABLE IF EXISTS lorebooks;');
  }

  // Create Tavern tables if not exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_prompts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sampler_presets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      temperature REAL NOT NULL DEFAULT 0.75,
      max_tokens INTEGER NOT NULL DEFAULT 300,
      top_p REAL NOT NULL DEFAULT 0.92,
      top_k INTEGER NOT NULL DEFAULT 100,
      min_p REAL NOT NULL DEFAULT 0.05,
      repetition_penalty REAL NOT NULL DEFAULT 1.05,
      frequency_penalty REAL NOT NULL DEFAULT 0,
      presence_penalty REAL NOT NULL DEFAULT 0,
      system_prompt_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_personas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lorebooks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lorebook_entries (
      id TEXT PRIMARY KEY,
      lorebook_id TEXT NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      is_constant INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      insertion_position TEXT NOT NULL DEFAULT 'after_scenario',
      created_at INTEGER NOT NULL
    );
  `);

  const now = Date.now();

  // Seed Moescape-style System Prompts
  const spCount = (db.prepare('SELECT COUNT(*) as cnt FROM system_prompts').get() as { cnt: number }).cnt;
  if (spCount === 0) {
    const insertSp = db.prepare(`
      INSERT INTO system_prompts (id, title, content, is_builtin, created_at)
      VALUES (?, ?, ?, 1, ?)
    `);
    insertSp.run(
      'sp_roleplay',
      'Roleplay',
      "Write {{char}}'s next response in a fictional role-play between {{char}} and {{user}}.",
      now
    );
    insertSp.run(
      'sp_spicy',
      'Spicy Roleplay',
      "Write {{char}}'s next response. Any act of role play scenarios will be described in vivid, unfiltered details.",
      now + 1
    );
    insertSp.run(
      'sp_default',
      'Default',
      "Write {{char}}'s next response.",
      now + 2
    );
    insertSp.run(
      'sp_long',
      'Long responses',
      'You are an immersive, creative roleplay partner with a talent for rich storytelling and deep character work. You ALWAYS write long, detailed, cinematic responses — no exceptions, no matter how small the action or dialogue. ## Length Requirements (Non-Negotiable) - Every single response must be **at minimum 3–5 paragraphs**. - Action scenes: describe every beat, movement, and consequence in full. - Dialogue scenes: include tone, expression, pauses, and the environment around the conversation. - Quiet or transitional moments: use them for world-building, atmosphere, and character reflection. - **Never summarize when you can show.** Never cut a scene short. Always write it out.',
      now + 3
    );
    insertSp.run(
      'sp_sol',
      'Sol (Narrator)',
      'You will narrate in third-person. You will focus narrating on whoever {{user}} is currently interacting with. {{char}} provides detailed descriptive prose and vivid results.',
      now + 4
    );
  }

  // Seed Sampler Presets
  const presetCount = (db.prepare('SELECT COUNT(*) as cnt FROM sampler_presets').get() as { cnt: number }).cnt;
  if (presetCount === 0) {
    const insertPreset = db.prepare(`
      INSERT INTO sampler_presets (
        id, title, description, temperature, max_tokens, top_p, top_k, min_p,
        repetition_penalty, frequency_penalty, presence_penalty, system_prompt_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertPreset.run(
      'preset_balanced',
      'Balanced Roleplay',
      'Grounded, natural character dialogue with balanced creativity (Temp 0.75, Top-P 0.92)',
      0.75,
      350,
      0.92,
      100,
      0.05,
      1.05,
      0,
      0,
      'sp_roleplay',
      now
    );
    insertPreset.run(
      'preset_creative',
      'Creative & Unfiltered',
      'Higher temperature and expressive prose for dramatic turns (Temp 0.95, Top-P 0.96)',
      0.95,
      500,
      0.96,
      100,
      0.03,
      1.08,
      0.1,
      0.1,
      'sp_spicy',
      now + 1
    );
    insertPreset.run(
      'preset_cinematic',
      'Cinematic Long-Form',
      'Configured for multi-paragraph novelistic storytelling (600 response tokens)',
      0.8,
      650,
      0.94,
      100,
      0.05,
      1.05,
      0,
      0,
      'sp_long',
      now + 2
    );
  }

  // Seed User Personas
  const personaCount = (db.prepare('SELECT COUNT(*) as cnt FROM user_personas').get() as { cnt: number }).cnt;
  if (personaCount === 0) {
    const insertPersona = db.prepare(`
      INSERT INTO user_personas (id, title, name, description, avatar_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertPersona.run(
      'persona_inspector_01',
      'Scotland Yard Inspector',
      'Inspector',
      '{{user}} is a sharp-eyed detective inspector who brought the encrypted Whitehall cylinder to 221B Baker Street. Calm under pressure, observant, and trusted by both Sherlock and Watson.',
      null,
      now
    );
    insertPersona.run(
      'persona_director_02',
      'Mysterious Client',
      'Alex',
      '{{user}} is an enigmatic private client with insider knowledge of diplomatic ciphers and high-society secrets.',
      null,
      now + 1
    );
  }

  // Seed Lorebooks & Entries
  const lbCount = (db.prepare('SELECT COUNT(*) as cnt FROM lorebooks').get() as { cnt: number }).cnt;
  if (lbCount === 0) {
    const lbId = 'lb_baker_street_01';
    db.prepare(`
      INSERT INTO lorebooks (id, title, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      lbId,
      'Victorian London & Whitehall Archives',
      'World lore for 221B Baker Street, Admiralty ciphers, and key London factions.',
      now
    );

    const insertEntry = db.prepare(`
      INSERT INTO lorebook_entries (
        id, lorebook_id, title, keywords, content, is_constant, is_enabled, insertion_position, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'after_scenario', ?)
    `);

    insertEntry.run(
      ulid(),
      lbId,
      'Whitehall Pneumatic Dispatch Network',
      'whitehall, pneumatic, tube, cylinder, dispatch',
      'The Whitehall Pneumatic Dispatch is a classified underground compressed-air tube network linking the Admiralty, Foreign Office, and Charing Cross telegraph station. Only three senior ministers and the First Sea Lord hold brass seal keys.',
      0,
      now
    );

    insertEntry.run(
      ulid(),
      lbId,
      'The Order of the White Camellia',
      'camellia, flower, conservatory, kew',
      'A fresh white camellia tucked beside an encrypted message is the calling card of the Langham Cabal—a ring of rogue continental intelligence brokers who trade stolen naval blueprints.',
      0,
      now + 1
    );

    insertEntry.run(
      ulid(),
      lbId,
      'Devonport Naval Cipher Protocol',
      'cipher, code, admiralty, devonport, parchment',
      'Admiralty ciphers written on Cornwall iron-gall parchment use a polyalphabetic keyword shifted by the date of the full moon. Attempting to burn the parchment reveals hidden silver-nitrate numerals along the margin.',
      0,
      now + 2
    );

    db.prepare(`
      UPDATE rooms
      SET active_lorebook_ids_json = '["lb_baker_street_01"]'
      WHERE id = 'room_baker_street_01' AND (active_lorebook_ids_json IS NULL OR active_lorebook_ids_json = '[]')
    `).run();
  }

  global.__tavernMigratedV4 = true;
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
  runTavernMigrationsAndSeed(global.__sqliteDb);
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
      override_model_tuning INTEGER NOT NULL DEFAULT 0,
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
      memory_box TEXT NOT NULL DEFAULT '',
      summary_model_id TEXT NOT NULL DEFAULT '',
      auto_summarize_interval INTEGER NOT NULL DEFAULT 0,
      active_lorebook_ids_json TEXT NOT NULL DEFAULT '["lb_baker_street_01"]',
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
      temperature REAL NOT NULL DEFAULT 0.75,
      max_tokens INTEGER NOT NULL DEFAULT 300,
      top_p REAL NOT NULL DEFAULT 0.92,
      top_k INTEGER NOT NULL DEFAULT 100,
      min_p REAL NOT NULL DEFAULT 0.05,
      repetition_penalty REAL NOT NULL DEFAULT 1.05,
      frequency_penalty REAL NOT NULL DEFAULT 0,
      presence_penalty REAL NOT NULL DEFAULT 0,
      active_system_prompt_id TEXT NOT NULL DEFAULT 'sp_roleplay',
      personas_enabled INTEGER NOT NULL DEFAULT 1,
      active_persona_id TEXT NOT NULL DEFAULT 'persona_inspector_01',
      active_preset_id TEXT,
      favorite_models_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
  `);

  runTavernMigrationsAndSeed(db);

  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM characters').get() as { cnt: number };
  if (countRow.cnt === 0) {
    const now = Date.now();
    const charSherlock = 'char_sherlock_01';
    const charWatson = 'char_watson_02';
    const charIrene = 'char_irene_03';
    const charKaelen = 'char_kaelen_04';

    const insertChar = db.prepare(`
      INSERT INTO characters (id, name, role_title, avatar_color, avatar_url, system_prompt, speaking_style, override_model_tuning, model_id, temperature, max_tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
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
      INSERT INTO rooms (
        id, title, scenario_prompt, user_display_name, turn_strategy, cooldown_ms, max_auto_turns,
        context_window_limit, memory_box, active_lorebook_ids_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      room1,
      '221B Baker Street: The Midnight Cipher',
      'Rain lashes against the tall windows of 221B Baker Street at 1:15 AM. On the center table lies an unsealed brass cylinder containing a charred naval cipher and a fresh white camellia. All participants are gathered around the table trying to determine who sent it and whether it is a trap.',
      'Inspector',
      'round_robin',
      3000,
      8,
      30,
      'The brass cylinder arrived at 1:15 AM via the Whitehall pneumatic dispatch tube. Half of the Admiralty cipher is intentionally scorched, and a fresh white camellia was tucked inside.',
      '["lb_baker_street_01"]',
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

export function parseCharacterOutfits(outfitsJson?: string | null): CharacterOutfit[] {
  if (!outfitsJson) return [];
  try {
    const parsed = JSON.parse(outfitsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveCharacterOutfit(
  character: Character,
  roomOutfitId?: string | null
): {
  outfits: CharacterOutfit[];
  activeOutfit: CharacterOutfit | null;
  effectiveAvatarUrl: string | null;
} {
  const outfits = parseCharacterOutfits(character.outfitsJson);
  const targetId = roomOutfitId !== undefined && roomOutfitId !== null
    ? roomOutfitId
    : character.activeOutfitId;
  const activeOutfit =
    (targetId ? outfits.find((o) => o.id === targetId) : null) ?? null;
  const effectiveAvatarUrl =
    activeOutfit?.avatarUrl || character.avatarUrl || null;

  return { outfits, activeOutfit, effectiveAvatarUrl };
}

// Row mappers
function mapCharacter(row: Record<string, unknown>): Character {
  return {
    id: String(row.id),
    name: String(row.name),
    roleTitle: String(row.role_title ?? 'Character'),
    avatarColor: String(row.avatar_color ?? '#6366f1'),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    appearance: String(row.appearance ?? ''),
    outfitsJson: String(row.outfits_json ?? '[]'),
    activeOutfitId: row.active_outfit_id ? String(row.active_outfit_id) : null,
    systemPrompt: String(row.system_prompt),
    speakingStyle: String(row.speaking_style ?? ''),
    overrideModelTuning: Boolean(row.override_model_tuning),
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
    memoryBox: String(row.memory_box ?? ''),
    summaryModelId: String(row.summary_model_id ?? ''),
    autoSummarizeInterval: Number(row.auto_summarize_interval ?? 0),
    activeLorebookIdsJson: String(row.active_lorebook_ids_json ?? '["lb_baker_street_01"]'),
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

export function createCharacter(
  input: Omit<Character, 'id' | 'createdAt' | 'overrideModelTuning' | 'appearance' | 'outfitsJson' | 'activeOutfitId'> & {
    overrideModelTuning?: boolean;
    appearance?: string;
    outfitsJson?: string;
    activeOutfitId?: string | null;
  }
): Character {
  const db = getRawDb();
  const id = `char_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO characters (
      id, name, role_title, avatar_color, avatar_url, appearance, outfits_json, active_outfit_id,
      system_prompt, speaking_style, override_model_tuning, model_id, temperature, max_tokens, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.roleTitle,
    input.avatarColor,
    input.avatarUrl ?? null,
    input.appearance ?? '',
    input.outfitsJson ?? '[]',
    input.activeOutfitId ?? null,
    input.systemPrompt,
    input.speakingStyle,
    input.overrideModelTuning ? 1 : 0,
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
  const updated = { ...existing, ...stripUndefined(input) };
  const db = getRawDb();
  db.prepare(`
    UPDATE characters
    SET name = ?, role_title = ?, avatar_color = ?, avatar_url = ?,
        appearance = ?, outfits_json = ?, active_outfit_id = ?,
        system_prompt = ?, speaking_style = ?, override_model_tuning = ?,
        model_id = ?, temperature = ?, max_tokens = ?
    WHERE id = ?
  `).run(
    updated.name,
    updated.roleTitle,
    updated.avatarColor,
    updated.avatarUrl ?? null,
    updated.appearance ?? '',
    updated.outfitsJson ?? '[]',
    updated.activeOutfitId ?? null,
    updated.systemPrompt,
    updated.speakingStyle,
    updated.overrideModelTuning ? 1 : 0,
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
      SELECT rc.room_id, rc.character_id, rc.turn_order, rc.is_active, rc.relationship_context, rc.active_outfit_id,
             c.id as c_id, c.name as c_name, c.role_title as c_role_title, c.avatar_color as c_avatar_color,
             c.avatar_url as c_avatar_url, c.appearance as c_appearance, c.outfits_json as c_outfits_json,
             c.active_outfit_id as c_active_outfit_id,
             c.system_prompt as c_system_prompt, c.speaking_style as c_speaking_style,
             c.override_model_tuning as c_override_model_tuning,
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
    activeOutfitId: r.active_outfit_id ? String(r.active_outfit_id) : null,
    character: {
      id: String(r.c_id),
      name: String(r.c_name),
      roleTitle: String(r.c_role_title ?? 'Character'),
      avatarColor: String(r.c_avatar_color ?? '#6366f1'),
      avatarUrl: r.c_avatar_url ? String(r.c_avatar_url) : null,
      appearance: String(r.c_appearance ?? ''),
      outfitsJson: String(r.c_outfits_json ?? '[]'),
      activeOutfitId: r.c_active_outfit_id ? String(r.c_active_outfit_id) : null,
      systemPrompt: String(r.c_system_prompt),
      speakingStyle: String(r.c_speaking_style ?? ''),
      overrideModelTuning: Boolean(r.c_override_model_tuning),
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
      INSERT INTO rooms (
        id, title, scenario_prompt, user_display_name, turn_strategy, cooldown_ms,
        max_auto_turns, context_window_limit, memory_box, active_lorebook_ids_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '["lb_baker_street_01"]', ?, ?)
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
    roster?: Array<{
      characterId: string;
      isActive?: boolean;
      relationshipContext?: string;
      activeOutfitId?: string | null;
    }>;
  }
): RoomWithDetails | null {
  const existing = getRoomWithDetails(roomId);
  if (!existing) return null;
  const db = getRawDb();
  const now = Date.now();
  const r = { ...existing.room, ...stripUndefined(input) };

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      UPDATE rooms
      SET title = ?, scenario_prompt = ?, user_display_name = ?, turn_strategy = ?,
          cooldown_ms = ?, max_auto_turns = ?, context_window_limit = ?,
          memory_box = ?, summary_model_id = ?, auto_summarize_interval = ?,
          active_lorebook_ids_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      r.title,
      r.scenarioPrompt,
      r.userDisplayName,
      r.turnStrategy,
      r.cooldownMs,
      r.maxAutoTurns,
      r.contextWindowLimit,
      r.memoryBox,
      r.summaryModelId,
      r.autoSummarizeInterval,
      r.activeLorebookIdsJson,
      now,
      roomId
    );

    if (input.roster) {
      const prevOutfitByChar = new Map<string, string | null>();
      existing.roster.forEach((m) => {
        prevOutfitByChar.set(m.characterId, m.activeOutfitId ?? null);
      });

      db.prepare('DELETE FROM room_characters WHERE room_id = ?').run(roomId);
      const insertRoster = db.prepare(`
        INSERT INTO room_characters (room_id, character_id, turn_order, is_active, relationship_context, active_outfit_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      input.roster.forEach((item, idx) => {
        const resolvedOutfitId =
          item.activeOutfitId !== undefined
            ? item.activeOutfitId
            : prevOutfitByChar.get(item.characterId) ?? null;
        insertRoster.run(
          roomId,
          item.characterId,
          idx,
          item.isActive === false ? 0 : 1,
          item.relationshipContext ?? '',
          resolvedOutfitId
        );
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
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(`
      DELETE FROM message_versions
      WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)
    `).run(roomId);
    db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_characters WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_queue_states WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
  const next = { ...cur, ...stripUndefined(patch), updatedAt: Date.now() };

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

// ==================== LLM SETTINGS & SAMPLERS ====================
export function getLlmSettings(): LlmSettings {
  const db = getRawDb();
  const row = db.prepare("SELECT * FROM llm_settings WHERE id = 'default'").get() as Record<string, unknown>;
  return {
    id: 'default',
    baseUrl: String(row.base_url || process.env.LLM_BASE_URL || 'https://api.openai.com/v1'),
    apiKey: String(row.api_key || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''),
    defaultModel: String(row.default_model || process.env.LLM_DEFAULT_MODEL || 'gpt-4o-mini'),
    useMockFallback: Boolean(row.use_mock_fallback),
    temperature: Number(row.temperature ?? 0.75),
    maxTokens: Number(row.max_tokens ?? 300),
    topP: Number(row.top_p ?? 0.92),
    topK: Number(row.top_k ?? 100),
    minP: Number(row.min_p ?? 0.05),
    repetitionPenalty: Number(row.repetition_penalty ?? 1.05),
    frequencyPenalty: Number(row.frequency_penalty ?? 0),
    presencePenalty: Number(row.presence_penalty ?? 0),
    activeSystemPromptId: String(row.active_system_prompt_id ?? 'sp_roleplay'),
    personasEnabled: row.personas_enabled === undefined ? true : Boolean(row.personas_enabled),
    activePersonaId: String(row.active_persona_id ?? 'persona_inspector_01'),
    activePresetId: row.active_preset_id ? String(row.active_preset_id) : null,
    favoriteModelsJson: String(row.favorite_models_json ?? '[]'),
    updatedAt: Number(row.updated_at),
  };
}

export function updateLlmSettings(patch: Partial<Omit<LlmSettings, 'id' | 'updatedAt'>>): LlmSettings {
  const db = getRawDb();
  const cur = getLlmSettings();
  const next = { ...cur, ...stripUndefined(patch), updatedAt: Date.now() };
  db.prepare(`
    UPDATE llm_settings
    SET base_url = ?, api_key = ?, default_model = ?, use_mock_fallback = ?,
        temperature = ?, max_tokens = ?, top_p = ?, top_k = ?, min_p = ?,
        repetition_penalty = ?, frequency_penalty = ?, presence_penalty = ?,
        active_system_prompt_id = ?, personas_enabled = ?, active_persona_id = ?,
        active_preset_id = ?, favorite_models_json = ?, updated_at = ?
    WHERE id = 'default'
  `).run(
    next.baseUrl,
    next.apiKey,
    next.defaultModel,
    next.useMockFallback ? 1 : 0,
    next.temperature,
    next.maxTokens,
    next.topP,
    next.topK,
    next.minP,
    next.repetitionPenalty,
    next.frequencyPenalty,
    next.presencePenalty,
    next.activeSystemPromptId,
    next.personasEnabled ? 1 : 0,
    next.activePersonaId,
    next.activePresetId ?? null,
    next.favoriteModelsJson,
    next.updatedAt
  );
  return getLlmSettings();
}

// ==================== TAVERN SYSTEM PROMPTS ====================
export function listSystemPrompts(): SystemPromptPreset[] {
  const db = getRawDb();
  const rows = db.prepare('SELECT * FROM system_prompts ORDER BY created_at ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    content: String(r.content),
    isBuiltin: Boolean(r.is_builtin),
    createdAt: Number(r.created_at),
  }));
}

export function createSystemPrompt(input: { title: string; content: string }): SystemPromptPreset {
  const db = getRawDb();
  const id = `sp_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO system_prompts (id, title, content, is_builtin, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(id, input.title, input.content, now);
  return listSystemPrompts().find((sp) => sp.id === id)!;
}

export function updateSystemPrompt(id: string, input: { title?: string; content?: string }): SystemPromptPreset | null {
  const db = getRawDb();
  const existing = listSystemPrompts().find((sp) => sp.id === id);
  if (!existing) return null;
  db.prepare('UPDATE system_prompts SET title = ?, content = ? WHERE id = ?').run(
    input.title ?? existing.title,
    input.content ?? existing.content,
    id
  );
  return listSystemPrompts().find((sp) => sp.id === id) ?? null;
}

export function deleteSystemPrompt(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM system_prompts WHERE id = ? AND is_builtin = 0').run(id);
}

// ==================== TAVERN SAMPLER PRESETS ====================
export function listSamplerPresets(): SamplerPreset[] {
  const db = getRawDb();
  const rows = db.prepare('SELECT * FROM sampler_presets ORDER BY created_at ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    description: String(r.description ?? ''),
    temperature: Number(r.temperature ?? 0.75),
    maxTokens: Number(r.max_tokens ?? 300),
    topP: Number(r.top_p ?? 0.92),
    topK: Number(r.top_k ?? 100),
    minP: Number(r.min_p ?? 0.05),
    repetitionPenalty: Number(r.repetition_penalty ?? 1.05),
    frequencyPenalty: Number(r.frequency_penalty ?? 0),
    presencePenalty: Number(r.presence_penalty ?? 0),
    systemPromptId: r.system_prompt_id ? String(r.system_prompt_id) : null,
    createdAt: Number(r.created_at),
  }));
}

export function createSamplerPreset(input: Omit<SamplerPreset, 'id' | 'createdAt'>): SamplerPreset {
  const db = getRawDb();
  const id = `preset_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO sampler_presets (
      id, title, description, temperature, max_tokens, top_p, top_k, min_p,
      repetition_penalty, frequency_penalty, presence_penalty, system_prompt_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title,
    input.description,
    input.temperature,
    input.maxTokens,
    input.topP,
    input.topK,
    input.minP,
    input.repetitionPenalty,
    input.frequencyPenalty,
    input.presencePenalty,
    input.systemPromptId ?? null,
    now
  );
  return listSamplerPresets().find((p) => p.id === id)!;
}

export function deleteSamplerPreset(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM sampler_presets WHERE id = ?').run(id);
}

// ==================== TAVERN USER PERSONAS ====================
export function listUserPersonas(): UserPersona[] {
  const db = getRawDb();
  const rows = db.prepare('SELECT * FROM user_personas ORDER BY created_at ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    name: String(r.name),
    description: String(r.description ?? ''),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    createdAt: Number(r.created_at),
  }));
}

export function getActiveUserPersona(): UserPersona | null {
  const settings = getLlmSettings();
  if (!settings.personasEnabled) return null;
  const all = listUserPersonas();
  return all.find((p) => p.id === settings.activePersonaId) ?? all[0] ?? null;
}

export function createUserPersona(input: Omit<UserPersona, 'id' | 'createdAt'>): UserPersona {
  const db = getRawDb();
  const id = `persona_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO user_personas (id, title, name, description, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.title, input.name, input.description, input.avatarUrl ?? null, now);
  return listUserPersonas().find((p) => p.id === id)!;
}

export function updateUserPersona(id: string, input: Partial<Omit<UserPersona, 'id' | 'createdAt'>>): UserPersona | null {
  const db = getRawDb();
  const existing = listUserPersonas().find((p) => p.id === id);
  if (!existing) return null;
  const next = { ...existing, ...stripUndefined(input) };
  db.prepare(`
    UPDATE user_personas
    SET title = ?, name = ?, description = ?, avatar_url = ?
    WHERE id = ?
  `).run(next.title, next.name, next.description, next.avatarUrl ?? null, id);
  return listUserPersonas().find((p) => p.id === id) ?? null;
}

export function deleteUserPersona(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM user_personas WHERE id = ?').run(id);
}

// ==================== TAVERN LOREBOOKS & ENTRIES ====================
export interface LorebookWithEntries extends Lorebook {
  entries: LorebookEntry[];
}

export function listLorebooksWithEntries(): LorebookWithEntries[] {
  const db = getRawDb();
  const lbRows = db.prepare('SELECT * FROM lorebooks ORDER BY created_at ASC').all() as Record<string, unknown>[];
  const entryRows = db.prepare('SELECT * FROM lorebook_entries ORDER BY created_at ASC').all() as Record<string, unknown>[];

  const entriesByLb = new Map<string, LorebookEntry[]>();
  for (const r of entryRows) {
    const entry: LorebookEntry = {
      id: String(r.id),
      lorebookId: String(r.lorebook_id),
      title: String(r.title),
      keywords: String(r.keywords ?? ''),
      content: String(r.content),
      isConstant: Boolean(r.is_constant),
      isEnabled: Boolean(r.is_enabled),
      insertionPosition: (r.insertion_position as LorebookEntry['insertionPosition']) ?? 'after_scenario',
      createdAt: Number(r.created_at),
    };
    const arr = entriesByLb.get(entry.lorebookId) ?? [];
    arr.push(entry);
    entriesByLb.set(entry.lorebookId, arr);
  }

  return lbRows.map((r) => {
    const id = String(r.id);
    return {
      id,
      title: String(r.title),
      description: String(r.description ?? ''),
      createdAt: Number(r.created_at),
      entries: entriesByLb.get(id) ?? [],
    };
  });
}

export function createLorebook(input: { title: string; description?: string }): LorebookWithEntries {
  const db = getRawDb();
  const id = `lb_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare('INSERT INTO lorebooks (id, title, description, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    input.title,
    input.description ?? '',
    now
  );
  return listLorebooksWithEntries().find((lb) => lb.id === id)!;
}

export function updateLorebook(id: string, input: { title?: string; description?: string }): LorebookWithEntries | null {
  const db = getRawDb();
  const existing = listLorebooksWithEntries().find((lb) => lb.id === id);
  if (!existing) return null;
  db.prepare('UPDATE lorebooks SET title = ?, description = ? WHERE id = ?').run(
    input.title ?? existing.title,
    input.description ?? existing.description,
    id
  );
  return listLorebooksWithEntries().find((lb) => lb.id === id) ?? null;
}

export function deleteLorebook(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM lorebooks WHERE id = ?').run(id);
}

export function createLorebookEntry(input: Omit<LorebookEntry, 'id' | 'createdAt'>): LorebookEntry {
  const db = getRawDb();
  const id = `lbe_${ulid().toLowerCase()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO lorebook_entries (
      id, lorebook_id, title, keywords, content, is_constant, is_enabled, insertion_position, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.lorebookId,
    input.title,
    input.keywords,
    input.content,
    input.isConstant ? 1 : 0,
    input.isEnabled ? 1 : 0,
    input.insertionPosition,
    now
  );
  const lbs = listLorebooksWithEntries();
  for (const lb of lbs) {
    const found = lb.entries.find((e) => e.id === id);
    if (found) return found;
  }
  throw new Error('Failed to create lorebook entry');
}

export function updateLorebookEntry(
  id: string,
  input: Partial<Omit<LorebookEntry, 'id' | 'lorebookId' | 'createdAt'>>
): LorebookEntry | null {
  const db = getRawDb();
  const lbs = listLorebooksWithEntries();
  let existing: LorebookEntry | undefined;
  for (const lb of lbs) {
    existing = lb.entries.find((e) => e.id === id);
    if (existing) break;
  }
  if (!existing) return null;
  const next = { ...existing, ...stripUndefined(input) };

  db.prepare(`
    UPDATE lorebook_entries
    SET title = ?, keywords = ?, content = ?, is_constant = ?, is_enabled = ?, insertion_position = ?
    WHERE id = ?
  `).run(
    next.title,
    next.keywords,
    next.content,
    next.isConstant ? 1 : 0,
    next.isEnabled ? 1 : 0,
    next.insertionPosition,
    id
  );

  for (const lb of listLorebooksWithEntries()) {
    const found = lb.entries.find((e) => e.id === id);
    if (found) return found;
  }
  return null;
}

export function deleteLorebookEntry(id: string): void {
  const db = getRawDb();
  db.prepare('DELETE FROM lorebook_entries WHERE id = ?').run(id);
}
