'use client';

import React, { useState, useEffect } from 'react';
import { Settings, X, Check, Server, Key, Cpu, Sparkles } from 'lucide-react';
import type { LlmSettings } from '@/lib/db/schema';

interface LlmSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESETS = [
  {
    label: 'OpenAI Official',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
  },
  {
    label: 'Ollama (Localhost)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
  },
  {
    label: 'LM Studio (Localhost)',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
  },
];

export function LlmSettingsModal({ isOpen, onClose }: LlmSettingsModalProps) {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('gpt-4o-mini');
  const [useMockFallback, setUseMockFallback] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: { settings?: LlmSettings }) => {
        if (data.settings) {
          setBaseUrl(data.settings.baseUrl);
          setApiKey(data.settings.apiKey);
          setDefaultModel(data.settings.defaultModel);
          setUseMockFallback(data.settings.useMockFallback);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedNotice(false);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl,
          apiKey,
          defaultModel,
          useMockFallback,
        }),
      });
      setSavedNotice(true);
      setTimeout(() => {
        setSavedNotice(false);
        onClose();
      }, 600);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">AI Provider & Engine Settings</h2>
              <p className="text-xs text-slate-400">
                OpenAI-compatible SSE endpoint persisted in local SQLite
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {/* Quick Presets */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              1-Click Provider Presets
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setBaseUrl(preset.baseUrl);
                    setDefaultModel(preset.defaultModel);
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-left text-xs transition cursor-pointer ${
                    baseUrl === preset.baseUrl
                      ? 'border-indigo-500 bg-indigo-950/60 text-indigo-200'
                      : 'border-slate-700/80 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold">{preset.label}</div>
                  <div className="truncate text-[10px] text-slate-400">{preset.baseUrl}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1">
              <Server className="h-3.5 w-3.5 text-indigo-400" />
              API Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1">
              <Key className="h-3.5 w-3.5 text-indigo-400" />
              API Key (Leave blank for local Ollama / LM Studio or Simulated Mode)
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Default Model */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-1">
              <Cpu className="h-3.5 w-3.5 text-indigo-400" />
              Default Model ID
            </label>
            <input
              type="text"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Simulated Stream Fallback */}
          <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={useMockFallback}
              onChange={(e) => setUseMockFallback(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-600 text-indigo-600 focus:ring-indigo-500"
            />
            <div className="text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                Enable Local Simulated Streaming Fallback
              </div>
              <p className="mt-0.5 text-slate-400">
                When enabled, if no API key is configured or the local LLM server is offline, characters will stream context-aware simulated responses so you can test turn-taking, AbortController interruptions, inline edits, and regeneration immediately.
              </p>
            </div>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
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
              {savedNotice ? 'Saved!' : isSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
