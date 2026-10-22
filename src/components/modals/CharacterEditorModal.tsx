'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, X, Check, Plus, Shirt, Sparkles } from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type { Character, CharacterOutfit } from '@/lib/db/schema';

export const AVATAR_COLORS = [
  '#6366f1',
  '#10b981',
  '#f43f5e',
  '#f59e0b',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#3b82f6',
];

interface CharacterEditorModalProps {
  isOpen: boolean;
  initialCharacter?: Character | null;
  onClose: () => void;
  onSave: (data: Omit<Character, 'id' | 'createdAt'>, existingId?: string) => Promise<void>;
}

export function CharacterEditorModal({
  isOpen,
  initialCharacter,
  onClose,
  onSave,
}: CharacterEditorModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outfitFileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [activeTab, setActiveTab] = useState<'persona' | 'wardrobe'>('persona');

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('Story Participant');
  const [avatarColor, setAvatarColor] = useState('#6366f1');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [appearance, setAppearance] = useState('');
  const [outfits, setOutfits] = useState<CharacterOutfit[]>([]);
  const [activeOutfitId, setActiveOutfitId] = useState<string | null>(null);

  const [systemPrompt, setSystemPrompt] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState('');
  const [overrideModelTuning, setOverrideModelTuning] = useState(false);
  const [modelId, setModelId] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState(0.75);
  const [maxTokens, setMaxTokens] = useState(450);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadingOutfitId, setUploadingOutfitId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab('persona');
    if (initialCharacter) {
      setName(initialCharacter.name);
      setRoleTitle(initialCharacter.roleTitle);
      setAvatarColor(initialCharacter.avatarColor);
      setAvatarUrl(initialCharacter.avatarUrl ?? null);
      setAppearance(initialCharacter.appearance || '');
      try {
        const parsed = JSON.parse(initialCharacter.outfitsJson || '[]');
        setOutfits(Array.isArray(parsed) ? parsed : []);
      } catch {
        setOutfits([]);
      }
      setActiveOutfitId(initialCharacter.activeOutfitId ?? null);
      setSystemPrompt(initialCharacter.systemPrompt);
      setSpeakingStyle(initialCharacter.speakingStyle);
      setOverrideModelTuning(Boolean(initialCharacter.overrideModelTuning));
      setModelId(initialCharacter.modelId || 'gpt-4o-mini');
      setTemperature(initialCharacter.temperature);
      setMaxTokens(initialCharacter.maxTokens);
    } else {
      setName('');
      setRoleTitle('Story Participant');
      setAvatarColor(AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]);
      setAvatarUrl(null);
      setAppearance('');
      setOutfits([]);
      setActiveOutfitId(null);
      setSystemPrompt('');
      setSpeakingStyle('');
      setOverrideModelTuning(false);
      setModelId('gpt-4o-mini');
      setTemperature(0.75);
      setMaxTokens(450);
    }
  }, [isOpen, initialCharacter]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/uploads/avatar', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setAvatarUrl(data.avatarUrl);
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleOutfitPictureUpload = async (
    outfitId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingOutfitId(outfitId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/uploads/avatar', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setOutfits((prev) =>
          prev.map((o) => (o.id === outfitId ? { ...o, avatarUrl: data.avatarUrl } : o))
        );
      }
    } finally {
      setUploadingOutfitId(null);
      const inputEl = outfitFileInputRefs.current[outfitId];
      if (inputEl) inputEl.value = '';
    }
  };

  const handleAddOutfit = () => {
    const newId = `outfit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newOutfit: CharacterOutfit = {
      id: newId,
      name: outfits.length === 0 ? 'Signature Outfit' : `Costume #${outfits.length + 1}`,
      avatarUrl: null,
      appearanceDescription: '',
      behaviorModifier: '',
    };
    const nextOutfits = [...outfits, newOutfit];
    setOutfits(nextOutfits);
    if (!activeOutfitId) {
      setActiveOutfitId(newId);
    }
  };

  const handleUpdateOutfit = (id: string, patch: Partial<CharacterOutfit>) => {
    setOutfits((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };

  const handleRemoveOutfit = (id: string) => {
    const next = outfits.filter((o) => o.id !== id);
    setOutfits(next);
    if (activeOutfitId === id) {
      setActiveOutfitId(next[0]?.id ?? null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) {
      setActiveTab('persona');
      return;
    }
    setIsSaving(true);
    try {
      const cleanedOutfits = outfits
        .map((o) => ({
          ...o,
          name: o.name.trim() || 'Outfit',
          appearanceDescription: o.appearanceDescription.trim(),
          behaviorModifier: o.behaviorModifier?.trim() || '',
        }))
        .filter((o) => o.name || o.appearanceDescription);

      await onSave(
        {
          name: name.trim(),
          roleTitle: roleTitle.trim() || 'Participant',
          avatarColor,
          avatarUrl,
          appearance: appearance.trim(),
          outfitsJson: JSON.stringify(cleanedOutfits),
          activeOutfitId:
            activeOutfitId && cleanedOutfits.some((o) => o.id === activeOutfitId)
              ? activeOutfitId
              : cleanedOutfits[0]?.id ?? null,
          systemPrompt: systemPrompt.trim(),
          speakingStyle: speakingStyle.trim(),
          overrideModelTuning,
          modelId: modelId.trim() || 'gpt-4o-mini',
          temperature,
          maxTokens,
        },
        initialCharacter?.id
      );
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const previewAvatarUrl =
    (activeOutfitId ? outfits.find((o) => o.id === activeOutfitId)?.avatarUrl : null) ||
    avatarUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5 shrink-0">
          <div>
            <h3 className="text-base font-bold text-white">
              {initialCharacter ? `Edit Character: ${initialCharacter.name}` : 'Create New AI Character'}
            </h3>
            <p className="text-xs text-slate-400">
              Configure persona, base physical traits, and multiple switchable outfits & portraits
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

        {/* Section Tabs: Persona & Identity vs Wardrobe & Outfits */}
        <div className="mt-3 flex items-center gap-2 border-b border-slate-800 pb-3 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('persona')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
              activeTab === 'persona'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            1. Persona & Appearance
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('wardrobe')}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition cursor-pointer ${
              activeTab === 'wardrobe'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Shirt className="h-3.5 w-3.5" />
            2. Wardrobe & Outfits
            <span className="rounded-full bg-slate-950/60 px-2 py-0.5 text-[10px]">
              {outfits.length}
            </span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex-1 overflow-y-auto pr-1 space-y-4">
          {activeTab === 'persona' ? (
            <>
              {/* Avatar Picture Upload & Accent Color Row */}
              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                <CharacterAvatar
                  name={name || 'AI'}
                  avatarColor={avatarColor}
                  avatarUrl={previewAvatarUrl}
                  size="xl"
                />

                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-600/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/30 cursor-pointer transition"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {isUploading ? 'Uploading...' : 'Upload Base Picture'}
                    </button>

                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl(null)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-950/80 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove Picture
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Badge/Ring Color:</span>
                    <div className="flex gap-1.5">
                      {AVATAR_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={`h-5 w-5 rounded-full border-2 cursor-pointer transition ${
                            avatarColor === color ? 'border-white scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Name & Role */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Character Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Sarah Chen"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Role / Title
                  </label>
                  <input
                    type="text"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    placeholder="e.g., Lead Intelligence Analyst"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Base Physical Appearance */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Base Physical Appearance (Hair, eyes, height, permanent features)
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('wardrobe')}
                    className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    + Manage Outfits ({outfits.length}) →
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={appearance}
                  onChange={(e) => setAppearance(e.target.value)}
                  placeholder="e.g., Tall with shoulder-length dark hair, observant hazel eyes, athletic build, calm expression..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-white leading-relaxed focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Core Character Persona */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Character Persona & Bio (Personality, background, motives) *
                </label>
                <textarea
                  rows={5}
                  required
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are... Describe their personality traits, knowledge, secrets, and how they interact with {{user}} and other characters."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-white leading-relaxed focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Speaking Style */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Speaking Style & Action Cadence
                </label>
                <input
                  type="text"
                  value={speakingStyle}
                  onChange={(e) => setSpeakingStyle(e.target.value)}
                  placeholder="e.g., Calm, articulate, uses brief italicized physical actions (*checks pocket watch*)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Optional Per-Character Model & Tuning Override */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      Override Tavern Model & Tuning for this Character
                    </div>
                    <div className="text-[11px] text-slate-400">
                      When unchecked, this character uses the shared Model & Sampler settings from Tavern Chat Settings.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={overrideModelTuning}
                    onChange={(e) => setOverrideModelTuning(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-500"
                  />
                </label>

                {overrideModelTuning && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Custom Model ID
                      </label>
                      <input
                        type="text"
                        value={modelId}
                        onChange={(e) => setModelId(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-slate-300 mb-1">
                        <span>Temperature</span>
                        <span className="font-mono text-indigo-300">{temperature}</span>
                      </div>
                      <input
                        type="range"
                        min={0.1}
                        max={1.5}
                        step={0.05}
                        value={temperature}
                        onChange={(e) => setTemperature(Number(e.target.value))}
                        className="w-full accent-indigo-500 mt-1.5"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Max Tokens
                      </label>
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        step={50}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* TAB 2: WARDROBE & MULTIPLE OUTFITS */
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5">
                <div>
                  <h4 className="text-xs font-bold text-indigo-200">
                    Character Wardrobe & Costumes
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Add multiple outfits with their own portrait image, clothing details, and mood notes. You can switch outfits anytime mid-chat!
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddOutfit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 cursor-pointer shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Outfit
                </button>
              </div>

              {outfits.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center">
                  <Shirt className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                  <p className="text-xs font-semibold text-slate-300">
                    No custom outfits added yet
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                    Click &ldquo;Add Outfit&rdquo; above to create costumes (e.g., Field Gear, Formal Attire, Casual Clothes) with dedicated pictures and descriptions.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {outfits.map((outfit, idx) => {
                    const isDefaultActive = activeOutfitId === outfit.id;
                    return (
                      <div
                        key={outfit.id}
                        className={`rounded-xl border p-4 space-y-3 transition ${
                          isDefaultActive
                            ? 'border-indigo-500/70 bg-indigo-950/20'
                            : 'border-slate-800 bg-slate-950/70'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                            <CharacterAvatar
                              name={name || 'Outfit'}
                              avatarColor={avatarColor}
                              avatarUrl={outfit.avatarUrl || avatarUrl}
                              size="lg"
                            />
                            <div className="flex-1 space-y-1.5">
                              <input
                                type="text"
                                value={outfit.name}
                                onChange={(e) =>
                                  handleUpdateOutfit(outfit.id, { name: e.target.value })
                                }
                                placeholder={`Outfit #${idx + 1} Name (e.g., Tactical Field Gear)`}
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white focus:border-indigo-500 focus:outline-none"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  ref={(el) => {
                                    outfitFileInputRefs.current[outfit.id] = el;
                                  }}
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp,image/gif"
                                  onChange={(e) => handleOutfitPictureUpload(outfit.id, e)}
                                  className="hidden"
                                />
                                <button
                                  type="button"
                                  disabled={uploadingOutfitId === outfit.id}
                                  onClick={() =>
                                    outfitFileInputRefs.current[outfit.id]?.click()
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:border-indigo-500 cursor-pointer"
                                >
                                  <Upload className="h-3 w-3" />
                                  {uploadingOutfitId === outfit.id
                                    ? 'Uploading...'
                                    : outfit.avatarUrl
                                    ? 'Change Outfit Pic'
                                    : 'Upload Outfit Pic'}
                                </button>
                                {outfit.avatarUrl && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateOutfit(outfit.id, { avatarUrl: null })
                                    }
                                    className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                                  >
                                    Reset to Base Pic
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setActiveOutfitId(isDefaultActive ? null : outfit.id)
                              }
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition ${
                                isDefaultActive
                                  ? 'bg-indigo-600 text-white'
                                  : 'border border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
                              }`}
                            >
                              {isDefaultActive ? '★ Equipped Default' : 'Set as Default'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveOutfit(outfit.id)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-950/50 hover:text-rose-400 cursor-pointer"
                              title="Delete outfit"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Costume & Appearance Description (Injected into AI prompt when worn)
                          </label>
                          <textarea
                            rows={2}
                            value={outfit.appearanceDescription}
                            onChange={(e) =>
                              handleUpdateOutfit(outfit.id, {
                                appearanceDescription: e.target.value,
                              })
                            }
                            placeholder="e.g., Wearing a dark weatherproof trench coat over a high-collar tactical vest, sturdy boots, and leather gloves."
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-xs text-white leading-relaxed focus:border-indigo-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Outfit Mood / Behavior Note (Optional)
                          </label>
                          <input
                            type="text"
                            value={outfit.behaviorModifier || ''}
                            onChange={(e) =>
                              handleUpdateOutfit(outfit.id, {
                                behaviorModifier: e.target.value,
                              })
                            }
                            placeholder="e.g., Adopts a more alert, disciplined posture and focused tone while wearing field gear"
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
            >
              <Check className="h-4 w-4" />
              {isSaving ? 'Saving...' : initialCharacter ? 'Save Changes' : 'Create Character'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
