'use client';

import React, { useState, useMemo } from 'react';
import {
  Zap,
  UserPlus,
  Sliders,
  Users,
  Plus,
  X,
  Pencil,
  Power,
  Search,
  ArrowUp,
  ArrowDown,
  MessageCircle,
  Brain,
  BookOpen,
  Shirt,
} from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import { CharacterEditorModal } from '../modals/CharacterEditorModal';
import type { TavernSettingsTab } from '../modals/TavernSettingsModal';
import type { RoomRosterMember } from '@/lib/db';
import type { Character, CharacterOutfit, Room } from '@/lib/db/schema';

interface RosterSidebarProps {
  room: Room;
  roster: RoomRosterMember[];
  allCharacters: Character[];
  activeCharacterId: string | null;
  nextCharacterId: string | null;
  isStreaming: boolean;
  activeUserDisplayName: string;
  onTriggerCharacter: (characterId: string, directAddressTo?: string) => void;
  onUpdateRoomSettings: (
    patch: Partial<Room> & {
      roster?: Array<{
        characterId: string;
        isActive?: boolean;
        relationshipContext?: string;
        activeOutfitId?: string | null;
      }>;
    }
  ) => Promise<void>;
  onCreateCharacter: (input: Omit<Character, 'id' | 'createdAt'>) => Promise<Character>;
  onUpdateCharacter: (id: string, patch: Partial<Character>) => Promise<void>;
  onOpenTavernSettings: (tab?: TavernSettingsTab) => void;
}

export function RosterSidebar({
  room,
  roster,
  allCharacters,
  activeCharacterId,
  nextCharacterId,
  isStreaming,
  activeUserDisplayName,
  onTriggerCharacter,
  onUpdateRoomSettings,
  onCreateCharacter,
  onUpdateCharacter,
  onOpenTavernSettings,
}: RosterSidebarProps) {
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isEditorModalOpen, setIsEditorModalOpen] = useState(false);
  const [poolSearchQuery, setPoolSearchQuery] = useState('');
  const [addressTargets, setAddressTargets] = useState<Record<string, string>>({});

  // Reorder turn order mid-chat
  const handleMoveTurnOrder = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= roster.length) return;
    const copy = [...roster];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);

    const updatedRoster = copy.map((item, idx) => ({
      characterId: item.characterId,
      turnOrder: idx,
      isActive: item.isActive,
      relationshipContext: item.relationshipContext,
    }));

    await onUpdateRoomSettings({ roster: updatedRoster });
  };

  const handleToggleRosterActive = async (characterId: string, currentActive: boolean) => {
    const nextRoster = roster.map((r) => ({
      characterId: r.characterId,
      isActive: r.characterId === characterId ? !currentActive : r.isActive,
      relationshipContext: r.relationshipContext,
      activeOutfitId: r.activeOutfitId ?? null,
    }));
    await onUpdateRoomSettings({ roster: nextRoster });
  };

  const handleSwitchCharacterRoomOutfit = async (
    characterId: string,
    outfitId: string | null
  ) => {
    const nextRoster = roster.map((r) => ({
      characterId: r.characterId,
      isActive: r.isActive,
      relationshipContext: r.relationshipContext,
      activeOutfitId: r.characterId === characterId ? outfitId : r.activeOutfitId ?? null,
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

  let activeLoreCount = 0;
  try {
    activeLoreCount = JSON.parse(room.activeLorebookIdsJson || '[]').length;
  } catch {
    activeLoreCount = 0;
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95">
      {/* Sidebar Header with Quick Tavern Settings Shortcuts */}
      <div className="border-b border-slate-800 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-bold text-white">
            <Users className="h-3.5 w-3.5 text-indigo-400" />
            Room Cast & Order ({roster.filter((r) => r.isActive).length}/{roster.length})
          </span>
          <button
            type="button"
            onClick={() => onOpenTavernSettings('model')}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:border-indigo-500 hover:text-white cursor-pointer transition"
          >
            <Sliders className="h-3 w-3 text-indigo-400" />
            Chat Settings
          </button>
        </div>

        {/* Quick Pills for Memory & Lorebook */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onOpenTavernSettings('memory')}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-indigo-500/50 cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Brain className="h-3 w-3 text-amber-400" />
              Memory
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              {room.memoryBox?.trim() ? 'Active' : 'Empty'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onOpenTavernSettings('lorebook')}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-indigo-500/50 cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 text-emerald-400" />
              Lorebooks
            </span>
            <span className="text-[10px] font-mono text-slate-400">{activeLoreCount}</span>
          </button>
        </div>
      </div>

      {/* Character Roster, Reordering & Targeted Interactions */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Turn Rotation Queue
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

          let parsedOutfits: CharacterOutfit[] = [];
          try {
            parsedOutfits = JSON.parse(c.outfitsJson || '[]');
          } catch {
            parsedOutfits = [];
          }
          const currentOutfitId =
            member.activeOutfitId !== null && member.activeOutfitId !== undefined
              ? member.activeOutfitId
              : c.activeOutfitId ?? '';
          const equippedOutfit = parsedOutfits.find((o) => o.id === currentOutfitId) ?? null;
          const effectiveAvatarUrl = equippedOutfit?.avatarUrl || c.avatarUrl;

          const targetOptions = [
            { label: 'The Room (Open response)', value: '' },
            { label: `${activeUserDisplayName} (You)`, value: activeUserDisplayName },
            ...roster
              .filter((other) => other.characterId !== c.id)
              .map((other) => ({
                label: other.character.name,
                value: other.character.name,
              })),
          ];

          const currentTarget = addressTargets[c.id] || '';

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
              {/* Header Row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative">
                    <CharacterAvatar
                      name={c.name}
                      avatarColor={c.avatarColor}
                      avatarUrl={effectiveAvatarUrl}
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

                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMoveTurnOrder(idx, -1)}
                    title="Move up in turn rotation"
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-20 cursor-pointer"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === roster.length - 1}
                    onClick={() => handleMoveTurnOrder(idx, 1)}
                    title="Move down in turn rotation"
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-20 cursor-pointer"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingCharacter(c);
                      setIsEditorModalOpen(true);
                    }}
                    title="Edit character persona, outfits & picture"
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleRosterActive(c.id, member.isActive)}
                    title={
                      member.isActive
                        ? 'Mute character (skips auto-rotation mid-chat)'
                        : 'Unmute character'
                    }
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
                      title="Remove character from this room (past messages stay in transcript)"
                      className="rounded p-1 text-slate-500 hover:bg-rose-950/50 hover:text-rose-300 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Wardrobe / Active Outfit Switcher (Mid-Chat Costume Switch) */}
              {parsedOutfits.length > 0 && (
                <div className="mt-2 rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-1.5 flex items-center gap-1.5 text-[11px]">
                  <Shirt className="h-3 w-3 text-indigo-400 shrink-0 ml-0.5" />
                  <span className="text-slate-400 shrink-0">Outfit:</span>
                  <select
                    value={currentOutfitId}
                    onChange={(e) =>
                      handleSwitchCharacterRoomOutfit(c.id, e.target.value || null)
                    }
                    className="w-full truncate bg-transparent font-medium text-indigo-200 focus:outline-none cursor-pointer"
                    title={
                      equippedOutfit?.appearanceDescription ||
                      'Switch character outfit & portrait in this room'
                    }
                  >
                    <option value="" className="bg-slate-900 text-slate-300">
                      Base Appearance (No Outfit)
                    </option>
                    {parsedOutfits.map((o) => (
                      <option key={o.id} value={o.id} className="bg-slate-900 text-white">
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Target Selection: "Who to Ask / Address" */}
              <div className="mt-2.5 rounded-lg border border-slate-800/80 bg-slate-950/70 p-1.5 flex items-center gap-1.5 text-[11px]">
                <MessageCircle className="h-3 w-3 text-indigo-400 shrink-0 ml-0.5" />
                <span className="text-slate-400 shrink-0">Address:</span>
                <select
                  value={currentTarget}
                  onChange={(e) =>
                    setAddressTargets((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  className="w-full truncate bg-transparent font-medium text-slate-200 focus:outline-none cursor-pointer"
                >
                  {targetOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Manual Trigger Button */}
              <button
                type="button"
                onClick={() => onTriggerCharacter(c.id, currentTarget || undefined)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/90 py-1.5 text-xs font-semibold text-slate-200 hover:border-indigo-500/60 hover:bg-indigo-600/20 hover:text-indigo-200 cursor-pointer transition"
              >
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Trigger {c.name.split(' ')[0]} to Speak
                {currentTarget ? ` → ${currentTarget.split(' ')[0]}` : ''}
              </button>
            </div>
          );
        })}

        {/* Add Character Mid-Chat Section */}
        <div className="pt-3 border-t border-slate-800 space-y-2">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Add Character Mid-Chat
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
                ? 'All characters in database are already in this room.'
                : 'No characters match your search.'}
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
                    Add to Chat
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Character Editor Modal */}
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
