import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  roleTitle: text('role_title').notNull().default('Character'),
  avatarColor: text('avatar_color').notNull().default('#6366f1'),
  avatarUrl: text('avatar_url'),
  systemPrompt: text('system_prompt').notNull(),
  speakingStyle: text('speaking_style').notNull().default(''),
  modelId: text('model_id').notNull().default('gpt-4o-mini'),
  temperature: real('temperature').notNull().default(0.75),
  maxTokens: integer('max_tokens').notNull().default(500),
  createdAt: integer('created_at').notNull(),
});

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  scenarioPrompt: text('scenario_prompt').notNull().default(''),
  userDisplayName: text('user_display_name').notNull().default('Director'),
  turnStrategy: text('turn_strategy', { enum: ['round_robin', 'dynamic_router', 'manual_only'] })
    .notNull()
    .default('round_robin'),
  cooldownMs: integer('cooldown_ms').notNull().default(3000),
  maxAutoTurns: integer('max_auto_turns').notNull().default(8),
  contextWindowLimit: integer('context_window_limit').notNull().default(30),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const roomCharacters = sqliteTable(
  'room_characters',
  {
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    characterId: text('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    turnOrder: integer('turn_order').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    relationshipContext: text('relationship_context').notNull().default(''),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roomId, table.characterId] }),
    roomOrderIdx: index('idx_room_turn_order').on(table.roomId, table.turnOrder),
  })
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    senderType: text('sender_type', { enum: ['user', 'character', 'system'] }).notNull(),
    characterId: text('character_id').references(() => characters.id, { onDelete: 'set null' }),
    senderNameSnapshot: text('sender_name_snapshot').notNull(),
    content: text('content').notNull(),
    originalContent: text('original_content'),
    isEdited: integer('is_edited', { mode: 'boolean' }).notNull().default(false),
    activeVersionIndex: integer('active_version_index').notNull().default(1),
    versionCount: integer('version_count').notNull().default(1),
    status: text('status', { enum: ['streaming', 'completed', 'aborted', 'error'] })
      .notNull()
      .default('completed'),
    sequenceNumber: integer('sequence_number').notNull(),
    promptDebugJson: text('prompt_debug_json'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    roomSeqIdx: index('idx_messages_room_seq').on(table.roomId, table.sequenceNumber),
  })
);

export const messageVersions = sqliteTable(
  'message_versions',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    versionIndex: integer('version_index').notNull(),
    content: text('content').notNull(),
    status: text('status', { enum: ['completed', 'aborted', 'error'] })
      .notNull()
      .default('completed'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    msgVerIdx: index('idx_message_versions').on(table.messageId, table.versionIndex),
  })
);

export const roomQueueStates = sqliteTable('room_queue_states', {
  roomId: text('room_id')
    .primaryKey()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  executionState: text('execution_state', {
    enum: ['IDLE', 'QUEUED', 'STREAMING', 'COOLDOWN', 'PAUSED'],
  })
    .notNull()
    .default('IDLE'),
  activeCharacterId: text('active_character_id').references(() => characters.id, {
    onDelete: 'set null',
  }),
  nextCharacterId: text('next_character_id').references(() => characters.id, {
    onDelete: 'set null',
  }),
  consecutiveAutoTurns: integer('consecutive_auto_turns').notNull().default(0),
  queuedCharacterIdsJson: text('queued_character_ids_json').notNull().default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

export const llmSettings = sqliteTable('llm_settings', {
  id: text('id').primaryKey(), // 'default'
  baseUrl: text('base_url').notNull().default('https://api.openai.com/v1'),
  apiKey: text('api_key').notNull().default(''),
  defaultModel: text('default_model').notNull().default('gpt-4o-mini'),
  useMockFallback: integer('use_mock_fallback', { mode: 'boolean' }).notNull().default(true),
  updatedAt: integer('updated_at').notNull(),
});

export type Character = typeof characters.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type RoomCharacter = typeof roomCharacters.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageVersion = typeof messageVersions.$inferSelect;
export type RoomQueueState = typeof roomQueueStates.$inferSelect;
export type LlmSettings = typeof llmSettings.$inferSelect;
