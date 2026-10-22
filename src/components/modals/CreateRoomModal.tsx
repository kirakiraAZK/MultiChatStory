'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  X,
  Check,
  ArrowLeft,
  ArrowRight,
  Users,
  UserPlus,
} from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type { Character } from '@/lib/db/schema';

interface CreateRoomModalProps {
  isOpen: boolean;
  allCharacters: Character[];
  onClose: () => void;
  onCreateRoom: (input: {
    title: string;
    scenarioPrompt: string;
    rosterCharacterIds: string[];
  }) => Promise<void>;
  onOpenNewCharacterModal: () => void;
}

export function CreateRoomModal({
  isOpen,
  allCharacters,
  onClose,
  onCreateRoom,
  onOpenNewCharacterModal,
}: CreateRoomModalProps) {
  const [title, setTitle] = useState('');
  const [scenarioPrompt, setScenarioPrompt] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rolesList = useMemo(() => {
    const s = new Set<string>();
    allCharacters.forEach((c) => {
      if (c.roleTitle.trim()) s.add(c.roleTitle.trim());
    });
    return ['ALL', ...Array.from(s)];
  }, [allCharacters]);

  const filteredCharacters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCharacters.filter((c) => {
      if (roleFilter !== 'ALL' && c.roleTitle !== roleFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.roleTitle.toLowerCase().includes(q) ||
        c.systemPrompt.toLowerCase().includes(q)
      );
    });
  }, [allCharacters, searchQuery, roleFilter]);

  if (!isOpen) return null;

  const toggleCharacter = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const moveOrder = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= selectedIds.length) return;
    const copy = [...selectedIds];
    const [item] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, item);
    setSelectedIds(copy);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || selectedIds.length < 1) return;
    setIsSubmitting(true);
    try {
      await onCreateRoom({
        title: title.trim(),
        scenarioPrompt: scenarioPrompt.trim(),
        rosterCharacterIds: selectedIds,
      });
      setTitle('');
      setScenarioPrompt('');
      setSelectedIds([]);
      setSearchQuery('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const charById = new Map(allCharacters.map((c) => [c.id, c]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-white">Create Multi-Character Chatroom</h3>
            <p className="text-xs text-slate-400">
              Define the scenario and search/select participating characters in speaking order
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Room Title & Scenario */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Room Title *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Helios-9 Command Bridge Crisis"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Shared Scenario & Setting Prompt
              </label>
              <input
                type="text"
                value={scenarioPrompt}
                onChange={(e) => setScenarioPrompt(e.target.value)}
                placeholder="Describe where the characters are and what is unfolding..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Selected Cast Bar (Turn Queue Order) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-indigo-400" />
                Selected Room Cast & Turn Order ({selectedIds.length} selected)
              </span>
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {selectedIds.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-500">
                Click characters in the searchable library below to add them to the room cast.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedIds.map((id, idx) => {
                  const c = charById.get(id);
                  if (!c) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-950/40 pl-2 pr-1.5 py-1.5 text-xs text-white"
                    >
                      <span className="rounded bg-indigo-600/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-200">
                        #{idx + 1}
                      </span>
                      <CharacterAvatar
                        name={c.name}
                        avatarColor={c.avatarColor}
                        avatarUrl={c.avatarUrl}
                        size="xs"
                      />
                      <span className="font-semibold">{c.name}</span>

                      <div className="flex items-center gap-0.5 ml-1 border-l border-slate-700/80 pl-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveOrder(idx, -1)}
                          className="p-0.5 text-slate-400 hover:text-white disabled:opacity-25 cursor-pointer"
                          title="Move earlier in turn order"
                        >
                          <ArrowLeft className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === selectedIds.length - 1}
                          onClick={() => moveOrder(idx, 1)}
                          className="p-0.5 text-slate-400 hover:text-white disabled:opacity-25 cursor-pointer"
                          title="Move later in turn order"
                        >
                          <ArrowRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCharacter(id)}
                          className="p-0.5 text-slate-400 hover:text-rose-400 cursor-pointer"
                          title="Remove from room"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Search & Filter Library Picker */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search across ${allCharacters.length} characters by name, role, or traits...`}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={onOpenNewCharacterModal}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/15 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/25 cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                + New Character
              </button>
            </div>

            {/* Role Filter Pills */}
            {rolesList.length > 2 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {rolesList.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setRoleFilter(role)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                      roleFilter === role
                        ? 'bg-slate-800 text-white border border-slate-600'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {role === 'ALL' ? 'All Roles' : role}
                  </button>
                ))}
              </div>
            )}

            {/* Character Cards Grid */}
            <div className="grid max-h-60 grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto pr-1">
              {filteredCharacters.map((c) => {
                const seatIndex = selectedIds.indexOf(c.id);
                const isSelected = seatIndex !== -1;

                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCharacter(c.id)}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 text-left transition cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-950/40 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CharacterAvatar
                        name={c.name}
                        avatarColor={c.avatarColor}
                        avatarUrl={c.avatarUrl}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-100">{c.name}</div>
                        <div className="truncate text-[11px] text-slate-400">{c.roleTitle}</div>
                      </div>
                    </div>

                    {isSelected ? (
                      <span className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white">
                        Seat #{seatIndex + 1}
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-[10px] font-medium text-slate-400">
                        + Select
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-800">
            <span className="text-xs text-slate-400">
              {selectedIds.length < 2
                ? 'Tip: Select at least 2 characters for multi-character interaction.'
                : `Ready with ${selectedIds.length} participating characters.`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim() || selectedIds.length === 0}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                {isSubmitting ? 'Creating...' : 'Create Chatroom'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
