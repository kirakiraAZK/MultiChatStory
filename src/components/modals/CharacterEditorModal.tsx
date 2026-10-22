'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, X, Check } from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type { Character } from '@/lib/db/schema';

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

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('Story Participant');
  const [avatarColor, setAvatarColor] = useState('#6366f1');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [speakingStyle, setSpeakingStyle] = useState('');
  const [overrideModelTuning, setOverrideModelTuning] = useState(false);
  const [modelId, setModelId] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState(0.75);
  const [maxTokens, setMaxTokens] = useState(450);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialCharacter) {
      setName(initialCharacter.name);
      setRoleTitle(initialCharacter.roleTitle);
      setAvatarColor(initialCharacter.avatarColor);
      setAvatarUrl(initialCharacter.avatarUrl ?? null);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;
    setIsSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          roleTitle: roleTitle.trim() || 'Participant',
          avatarColor,
          avatarUrl,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div>
            <h3 className="text-base font-bold text-white">
              {initialCharacter ? `Edit Character: ${initialCharacter.name}` : 'Create New AI Character'}
            </h3>
            <p className="text-xs text-slate-400">
              Upload a portrait, define their persona & speaking style (supports {'{{user}}'} and {'{{char}}'})
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Avatar Picture Upload & Accent Color Row */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
            <CharacterAvatar
              name={name || 'AI'}
              avatarColor={avatarColor}
              avatarUrl={avatarUrl}
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
                  {isUploading ? 'Uploading...' : 'Upload Picture'}
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
                placeholder="e.g., Sherlock Holmes"
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
                placeholder="e.g., Consulting Detective"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
              />
            </div>
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
              placeholder="e.g., Crisp, analytical, uses brief italicized physical actions (*paces*)"
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

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
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
