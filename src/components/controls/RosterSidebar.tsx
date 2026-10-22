'use client';

import React, { useState, useMemo } from 'react';
import {
  Zap,
  UserPlus,
  Sliders,
  Users,
  Plus,
  Check,
  X,
  Pencil,
  Power,
  Search,
} from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import { CharacterEditorModal } from '../modals/CharacterEditorModal';
import type { RoomRosterMember } from '@/lib/db';
import type { Character, Room } from '@/lib/db/schema';

interface RosterSidebarProps {
  room: Room;
  roster: RoomRosterMember[];
  allCharacters: Character[];
  activeCharacterId: string | null;
  nextCharacterId: string | null;
  isStreaming: boolean;
  onTriggerCharacter: (characterId: string) => void;
  onUpdateRoomSettings: (
    patch: Partial<Room> & {
      roster?: Array<{ characterId: string; isActive?: boolean; relationshipContext?: string }>;
    }
  ) => Promise<void>;
  onCreateCharacter: (input: Omit<Character, 'id' | 'createdAt'>) => Promise<Character>;
  onUpdateCharacter: (id: string, patch: Partial<Character>) => Promise<void>;
}

export function RosterSidebar({
  room,
  roster,
  allCharacters,
  activeCharacterId,
  nextCharacterId,
  isStreaming,
  onTriggerCharacter,
  onUpdateRoomSettings,
  onCreateCharacter,
  onUpdateCharacter,
}: RosterSidebarProps) {
  const [activeTab, setActiveTab] = useState<'roster' | 'room_config'>('roster');
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [poolSearchQuery, setPoolSearchQuery] = useState('');

  // Room config state
  const [scenarioDraft, setScenarioDraft] = useState(room.scenarioPrompt);
  const [userDisplayDraft, setUserDisplayDraft] = useState(room.userDisplayName);
  const [strategyDraft, setStrategyDraft] = useState<Room['turnStrategy']>(room.turnStrategy);
  const [cooldownDraft, setCooldownDraft] = useState(room.cooldownMs);
  const [maxTurnsDraft, setMaxTurnsDraft] = useState(room.maxAutoTurns);
  const [isSavingRoom, setIsSavingRoom] = useState(false);

  const handleToggleRosterActive = async (characterId: string, currentActive: boolean) => {
    const nextRoster = roster.map((r) => ({
      characterId: r.characterId,
      isActive: r.characterId === characterId ? !currentActive : r.isActive,
      relationshipContext: r.relationshipContext,
    }));
    await onUpdateRoomSettings({ roster: nextRoster });
  };

  const handleAddExistingCharToRoom = async (characterId: string) => {
    if (roster.some((r) => r.characterId === characterId)) return;
    await onUpdateRoomSettings({
      roster: [
        ...roster.map((r) => ({
          characterId: r.characterId,
          isActive: r.isActive,
          relationshipContext: r.relationshipContext,
        })),
        { characterId, isActive: true, relationshipContext: '' },
      ],
    });
  };

  const handleRemoveCharFromRoom = async (characterId: string) => {
    await onUpdateRoomSettings({
      roster: roster
        .filter((r) => r.characterId !== characterId)
        .map((r) => ({
          characterId: r.characterId,
          isActive: r.isActive,
          relationshipContext: r.relationshipContext,
        })),
    });
  };

  const handleSaveRoomSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingRoom(true);
    try {
      await onUpdateRoomSettings({
        scenarioPrompt: scenarioDraft,
        userDisplayName: userDisplayDraft.trim() || 'Director',
        turnStrategy: strategyDraft,
        cooldownMs: Number(cooldownDraft),
        maxAutoTurns: Number(maxTurnsDraft),
      });
    } finally {
      setIsSavingRoom(false);
    }
  };

  const unassignedCharacters = useMemo(() => {
    const q = poolSearchQuery.trim().toLowerCase();
    return allCharacters.filter((c) => {
      if (roster.some((r) => r.characterId === c.id)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.roleTitle.toLowerCase().includes(q)
      );
    });
  }, [allCharacters, roster, poolSearchQuery]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95">
      {/* Sidebar Tabs */}
      <div className="flex border-b border-slate-800 p-2 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('roster')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'roster'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          Cast ({roster.filter((r) => r.isActive).length}/{roster.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setScenarioDraft(room.scenarioPrompt);
            setUserDisplayDraft(room.userDisplayName);
            setStrategyDraft(room.turnStrategy);
            setCooldownDraft(room.cooldownMs);
            setMaxTurnsDraft(room.maxAutoTurns);
            setActiveTab('room_config');
          }}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${
            activeTab === 'room_config'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          Room & Loop Rules
        </button>
      </div>

      {/* Tab 1: Character Roster & Manual Turn Triggers */}
      {activeTab === 'roster' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Room Cast & Turn Queue
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingCharacter(null);
                setIsEditorModalOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600/20 border border-indigo-500/40 px-2 py-1 text-xs font-medium text-indigo-300 hover:bg-indigo-600/30 cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              New Persona
            </button>
          </div>

          {roster.map((member, idx) => {
            const c = member.character;
            const isSpeakingNow = activeCharacterId === c.id && isStreaming;
            const isQueuedNext = nextCharacterId === c.id && !isStreaming;

            return (
              <div
                key={c.id}
                className={`rounded-xl border p-3 transition ${
                  isSpeakingNow
                    ? 'border-indigo-500 bg-indigo-950/30 shadow-md shadow-indigo-950/40'
                    : isQueuedNext
                    ? 'border-slate-700 bg-slate-800/75'
                    : member.isActive
                    ? 'border-slate-800 bg-slate-900/90'
                    : 'border-slate-800/50 bg-slate-950/50 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative">
                      <CharacterAvatar
                        name={c.name}
                        avatarColor={c.avatarColor}
                        avatarUrl={c.avatarUrl}
                        size="md"
                      />
                      <span className="absolute -bottom-1 -right-1 rounded bg-slate-950/90 border border-slate-700 px-1 text-[9px] font-mono font-bold text-slate-300">
                        #{idx + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="truncate text-xs font-bold text-slate-100">{c.name}</h4>
                        {isSpeakingNow && (
                          <span className="rounded bg-indigo-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200 animate-pulse">
                            LIVE
                          </span>
                        )}
                        {isQueuedNext && (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            NEXT
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-slate-400">{c.roleTitle}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCharacter(c);
                        setIsEditorModalOpen(true);
                      }}
                      title="Edit character persona & picture"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleRosterActive(c.id, member.isActive)}
                      title={member.isActive ? 'Mute character in auto-rotation' : 'Activate character'}
                      className={`rounded p-1 cursor-pointer ${
                        member.isActive
                          ? 'text-emerald-400 hover:bg-slate-800'
                          : 'text-slate-600 hover:bg-slate-800 hover:text-slate-300'
                      }`}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    {roster.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCharFromRoom(c.id)}
                        title="Remove from room"
                        className="rounded p-1 text-slate-500 hover:bg-rose-950/50 hover:text-rose-300 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-2 line-clamp-2 text-[11px] text-slate-400 leading-relaxed">
                  {c.systemPrompt}
                </p>

                {/* Manual Intervention Button: Force This Character to Speak Now */}
                <button
                  type="button"
                  onClick={() => onTriggerCharacter(c.id)}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/90 py-1.5 text-xs font-semibold text-slate-200 hover:border-indigo-500/60 hover:bg-indigo-600/20 hover:text-indigo-200 cursor-pointer transition"
                >
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  Trigger {c.name.split(' ')[0]} to Speak
                </button>
              </div>
            );
          })}

          {/* Searchable Unassigned Character Pool */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Add from Character Database
            </span>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={poolSearchQuery}
                onChange={(e) => setPoolSearchQuery(e.target.value)}
                placeholder="Search character database..."
                className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-8 pr-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {unassignedCharacters.length === 0 ? (
              <p className="text-[11px] text-slate-500 py-1">
                {allCharacters.length === roster.length
                  ? 'All characters in your database are already in this room.'
                  : 'No unassigned characters match your search.'}
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
                {unassignedCharacters.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CharacterAvatar
                        name={c.name}
                        avatarColor={c.avatarColor}
                        avatarUrl={c.avatarUrl}
                        size="sm"
                      />
                      <div className="truncate">
                        <div className="text-xs font-medium text-slate-200 truncate">{c.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{c.roleTitle}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddExistingCharToRoom(c.id)}
                      className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-600 hover:text-white cursor-pointer shrink-0"
                    >
                      <UserPlus className="h-3 w-3" />
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab 2: Room Scenario & Auto-Turn Loop Configuration */
        <form onSubmit={handleSaveRoomSettings} className="flex-1 overflow-y-auto p-3.5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Your Display Name in Transcript
            </label>
            <input
              type="text"
              value={userDisplayDraft}
              onChange={(e) => setUserDisplayDraft(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Turn Orchestration Strategy
            </label>
            <select
              value={strategyDraft}
              onChange={(e) => setStrategyDraft(e.target.value as Room['turnStrategy'])}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="round_robin">Round-Robin (Seat Order #1 → #2 → #3)</option>
              <option value="dynamic_router">Dynamic Relevance (Prioritizes Addressed Character)</option>
              <option value="manual_only">Manual Trigger Only</option>
            </select>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold text-slate-300">Turn Cooldown Buffer</span>
              <span className="font-mono text-amber-300">{(cooldownDraft / 1000).toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={500}
              max={10000}
              step={500}
              value={cooldownDraft}
              onChange={(e) => setCooldownDraft(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-0.5">
              Interactive countdown delay before the next character turn fires.
            </p>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold text-slate-300">Max Auto-Turns Limit</span>
              <span className="font-mono text-indigo-300">{maxTurnsDraft} turns</span>
            </div>
            <input
              type="range"
              min={2}
              max={25}
              step={1}
              value={maxTurnsDraft}
              onChange={(e) => setMaxTurnsDraft(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <p className="text-[11px] text-slate-500 mt-0.5">
              Automatically pauses auto-chat when reached to prevent runaway token loops.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Shared Scenario & World Setting Prompt
            </label>
            <textarea
              rows={5}
              value={scenarioDraft}
              onChange={(e) => setScenarioDraft(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
              placeholder="Describe the scene, atmosphere, and shared objective..."
            />
          </div>

          <button
            type="submit"
            disabled={isSavingRoom}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
          >
            <Check className="h-3.5 w-3.5" />
            {isSavingRoom ? 'Saving...' : 'Save Room Configuration'}
          </button>
        </form>
      )}

      {/* Character Editor Modal (with Picture Upload) */}
      <CharacterEditorModal
        isOpen={isEditorModalOpen}
        initialCharacter={editingCharacter}
        onClose={() => {
          setIsEditorModalOpen(false);
          setEditingCharacter(null);
        }}
        onSave={async (data, existingId) => {
          if (existingId) {
            await onUpdateCharacter(existingId, data);
          } else {
            const created = await onCreateCharacter(data);
            await onUpdateRoomSettings({
              roster: [
                ...roster.map((r) => ({
                  characterId: r.characterId,
                  isActive: r.isActive,
                  relationshipContext: r.relationshipContext,
                })),
                { characterId: created.id, isActive: true, relationshipContext: '' },
              ],
            });
          }
        }}
      />
    </aside>
  );
}
