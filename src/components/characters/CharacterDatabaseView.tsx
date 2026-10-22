'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  UserPlus,
  Pencil,
  Copy,
  Trash2,
  Sparkles,
  MessagesSquare,
  SlidersHorizontal,
  Shirt,
} from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import { CharacterEditorModal } from '../modals/CharacterEditorModal';
import type { Character, CharacterOutfit } from '@/lib/db/schema';
import type { RoomWithDetails } from '@/lib/db';

interface CharacterDatabaseViewProps {
  characters: Character[];
  rooms: RoomWithDetails[];
  onCreateCharacter: (data: Omit<Character, 'id' | 'createdAt'>) => Promise<Character>;
  onUpdateCharacter: (id: string, data: Partial<Omit<Character, 'id' | 'createdAt'>>) => Promise<void>;
  onDeleteCharacter: (id: string) => Promise<void>;
  onOpenRoom: (roomId: string) => void;
}

export function CharacterDatabaseView({
  characters,
  rooms,
  onCreateCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onOpenRoom,
}: CharacterDatabaseViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('ALL');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingChar, setEditingChar] = useState<Character | null>(null);

  // Extract unique role titles for quick filtering
  const roleCategories = useMemo(() => {
    const set = new Set<string>();
    characters.forEach((c) => {
      if (c.roleTitle.trim()) set.add(c.roleTitle.trim());
    });
    return ['ALL', ...Array.from(set)];
  }, [characters]);

  const filteredCharacters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return characters.filter((c) => {
      if (selectedRoleFilter !== 'ALL' && c.roleTitle !== selectedRoleFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.roleTitle.toLowerCase().includes(q) ||
        c.systemPrompt.toLowerCase().includes(q) ||
        c.speakingStyle.toLowerCase().includes(q)
      );
    });
  }, [characters, searchQuery, selectedRoleFilter]);

  // Map characterId -> rooms they belong to
  const roomsByCharacter = useMemo(() => {
    const map = new Map<string, Array<{ id: string; title: string }>>();
    for (const r of rooms) {
      for (const member of r.roster) {
        const list = map.get(member.characterId) ?? [];
        list.push({ id: r.room.id, title: r.room.title });
        map.set(member.characterId, list);
      }
    }
    return map;
  }, [rooms]);

  const handleDuplicate = async (c: Character) => {
    await onCreateCharacter({
      name: `${c.name} (Copy)`,
      roleTitle: c.roleTitle,
      avatarColor: c.avatarColor,
      avatarUrl: c.avatarUrl,
      appearance: c.appearance,
      outfitsJson: c.outfitsJson,
      activeOutfitId: c.activeOutfitId,
      systemPrompt: c.systemPrompt,
      speakingStyle: c.speakingStyle,
      overrideModelTuning: c.overrideModelTuning,
      modelId: c.modelId,
      temperature: c.temperature,
      maxTokens: c.maxTokens,
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-950">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/70 px-6 py-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            Character Database & Persona Studio
            <span className="rounded-full bg-indigo-500/20 border border-indigo-500/40 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
              {characters.length} Total
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage AI character portraits, system prompts, speaking styles, and LLM parameters across all rooms
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingChar(null);
            setIsEditorOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
        >
          <UserPlus className="h-4 w-4" />
          Create New Character
        </button>
      </header>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/40 px-6 py-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search characters by name, role, system prompt, or style..."
            className="w-full rounded-xl border border-slate-700/80 bg-slate-950 pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500 mr-1 shrink-0" />
          {roleCategories.slice(0, 7).map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setSelectedRoleFilter(role)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                selectedRoleFilter === role
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {role === 'ALL' ? 'All Roles' : role}
            </button>
          ))}
        </div>
      </div>

      {/* Character Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredCharacters.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 text-center">
            <Sparkles className="h-8 w-8 text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-300">No matching characters found</p>
            <p className="text-xs text-slate-500 mt-1">
              Try clearing your search filter or create a new character persona.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCharacters.map((c) => {
              const assignedRooms = roomsByCharacter.get(c.id) ?? [];
              let parsedOutfits: CharacterOutfit[] = [];
              try {
                parsedOutfits = JSON.parse(c.outfitsJson || '[]');
              } catch {
                parsedOutfits = [];
              }
              const activeOutfit = parsedOutfits.find((o) => o.id === c.activeOutfitId);
              const displayAvatar = activeOutfit?.avatarUrl || c.avatarUrl;

              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/85 p-4 hover:border-slate-700 transition shadow-sm"
                >
                  <div>
                    {/* Card Header: Avatar + Name + Action Buttons */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <CharacterAvatar
                          name={c.name}
                          avatarColor={c.avatarColor}
                          avatarUrl={displayAvatar}
                          size="lg"
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-white">{c.name}</h3>
                          <p className="truncate text-xs text-indigo-300/90">{c.roleTitle}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                            <span className="rounded bg-slate-800 px-1.5 py-0.5">{c.modelId}</span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5">
                              temp {c.temperature}
                            </span>
                            {parsedOutfits.length > 0 && (
                              <span className="inline-flex items-center gap-1 rounded bg-indigo-500/20 border border-indigo-500/40 px-1.5 py-0.5 text-indigo-300 font-sans">
                                <Shirt className="h-2.5 w-2.5" />
                                {parsedOutfits.length} outfit{parsedOutfits.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingChar(c);
                            setIsEditorOpen(true);
                          }}
                          className="rounded-lg border border-slate-700/80 bg-slate-800/90 p-1.5 text-slate-300 hover:border-indigo-500 hover:text-white cursor-pointer"
                          title="Edit character & upload picture"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(c)}
                          className="rounded-lg border border-slate-700/80 bg-slate-800/90 p-1.5 text-slate-300 hover:border-slate-600 hover:text-white cursor-pointer"
                          title="Duplicate character"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteCharacter(c.id)}
                          className="rounded-lg border border-transparent p-1.5 text-slate-500 hover:border-rose-800/60 hover:bg-rose-950/40 hover:text-rose-300 cursor-pointer"
                          title="Delete character from database"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* System Prompt Preview */}
                    <div className="mt-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                        System Persona
                      </div>
                      <p className="line-clamp-3 text-xs text-slate-300 leading-relaxed">
                        {c.systemPrompt}
                      </p>
                    </div>

                    {/* Speaking Style */}
                    {c.speakingStyle && (
                      <div className="mt-2 text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-300">Style: </span>
                        <span className="italic">{c.speakingStyle}</span>
                      </div>
                    )}
                  </div>

                  {/* Assigned Rooms Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1 min-w-0">
                      <MessagesSquare className="h-3.5 w-3.5 text-slate-500 mr-1 shrink-0" />
                      {assignedRooms.length === 0 ? (
                        <span className="text-[11px] text-slate-500">Not in any room yet</span>
                      ) : (
                        assignedRooms.map((rm) => (
                          <button
                            key={rm.id}
                            type="button"
                            onClick={() => onOpenRoom(rm.id)}
                            className="truncate max-w-[160px] rounded-md bg-slate-800/90 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-indigo-600/30 hover:text-indigo-200 cursor-pointer"
                          >
                            {rm.title}
                          </button>
                        ))
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingChar(c);
                        setIsEditorOpen(true);
                      }}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 shrink-0 cursor-pointer"
                    >
                      Configure →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Character Create / Edit Modal */}
      <CharacterEditorModal
        isOpen={isEditorOpen}
        initialCharacter={editingChar}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingChar(null);
        }}
        onSave={async (data, existingId) => {
          if (existingId) {
            await onUpdateCharacter(existingId, data);
          } else {
            await onCreateCharacter(data);
          }
        }}
      />
    </div>
  );
}
