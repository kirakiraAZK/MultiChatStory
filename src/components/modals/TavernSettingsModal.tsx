'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Search,
  Heart,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Check,
  Plus,
  Trash2,
  Sparkles,
  Upload,
  RefreshCw,
  BookOpen,
  Cpu,
  FileText,
  Sliders,
  UserCheck,
  Brain,
  Clapperboard,
  Server,
  MapPin,
  Clock,
  KeyRound,
  Zap,
  ShieldCheck,
  Image as ImageIcon,
} from 'lucide-react';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type {
  LlmSettings,
  SystemPromptPreset,
  SamplerPreset,
  UserPersona,
  Room,
  RoomSubPlace,
  TimeOfDay,
  ImageGenerationProvider,
  LorebookEntry,
} from '@/lib/db/schema';
import type { LorebookWithEntries } from '@/lib/db';
import type { ProviderModelItem } from '@/app/api/models/route';

export type TavernSettingsTab =
  | 'model'
  | 'system_prompt'
  | 'presets'
  | 'persona'
  | 'memory'
  | 'places_time'
  | 'scenario'
  | 'lorebook';

interface TavernSettingsModalProps {
  isOpen: boolean;
  initialTab?: TavernSettingsTab;
  activeRoom: Room | null;
  onClose: () => void;
  onUpdateRoom: (patch: Partial<Room>) => Promise<void>;
  onSettingsChanged: () => void;
  onRequestDeleteRoom?: (roomId: string) => void;
}

interface UnifiedSettingsPayload {
  settings: LlmSettings;
  systemPrompts: SystemPromptPreset[];
  samplerPresets: SamplerPreset[];
  userPersonas: UserPersona[];
  lorebooks: LorebookWithEntries[];
}

const PROVIDER_PRESETS: Array<{
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  description: string;
}> = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-... (platform.openai.com)',
    description: 'Official OpenAI API (GPT-4o, GPT-4o-mini)',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    keyPlaceholder: 'sk-ant-... (console.anthropic.com)',
    description: 'Anthropic Claude Messages API (Claude 3.5 Sonnet & Haiku)',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    keyPlaceholder: 'AIzaSy... (aistudio.google.com)',
    description: 'Google AI Studio Gemini API (Gemini 2.0 Flash, 1.5 Pro)',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    keyPlaceholder: 'sk-or-... (openrouter.ai/keys)',
    description: 'Universal gateway for all models (OpenAI, Claude, Llama, DeepSeek, free tier)',
  },
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    keyPlaceholder: 'None required (local server)',
    description: 'Runs open-weights LLMs 100% free on your local machine',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (Local)',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    keyPlaceholder: 'None required (local server)',
    description: 'Local GUI inference server with OpenAI-compatible API',
  },
  {
    id: 'custom_openai',
    label: 'Custom OpenAI-Compatible',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'custom-model',
    keyPlaceholder: 'API key for your custom server',
    description: 'Connect any OpenAI-compatible server (DeepSeek, Groq, Together, vLLM, KoboldCPP)',
  },
];

export function TavernSettingsModal({
  isOpen,
  initialTab = 'model',
  activeRoom,
  onClose,
  onUpdateRoom,
  onSettingsChanged,
  onRequestDeleteRoom,
}: TavernSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TavernSettingsTab>(initialTab);
  const [data, setData] = useState<UnifiedSettingsPayload | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // ==================== 1. MODEL & TUNING STATE ====================
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('gpt-4o-mini');
  const [useMockFallback, setUseMockFallback] = useState(true);
  const [showApiConnectionBox, setShowApiConnectionBox] = useState(true);

  const [providerModels, setProviderModels] = useState<ProviderModelItem[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);

  // Samplers (Right Pane of Model Tab)
  const [maxTokens, setMaxTokens] = useState(300);
  const [temperature, setTemperature] = useState(0.75);
  const [showAdvancedSamplers, setShowAdvancedSamplers] = useState(true);
  const [topP, setTopP] = useState(0.92);
  const [topK, setTopK] = useState(100);
  const [repetitionPenalty, setRepetitionPenalty] = useState(1.05);
  const [minP, setMinP] = useState(0.05);
  const [frequencyPenalty, setFrequencyPenalty] = useState(0);
  const [presencePenalty, setPresencePenalty] = useState(0);

  // ==================== 2. SYSTEM PROMPT STATE ====================
  const [selectedSpId, setSelectedSpId] = useState('sp_roleplay');
  const [spTitleDraft, setSpTitleDraft] = useState('');
  const [spContentDraft, setSpContentDraft] = useState('');

  // ==================== 3. SAMPLER PRESETS STATE ====================
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [newPresetTitle, setNewPresetTitle] = useState('');
  const [newPresetDesc, setNewPresetDesc] = useState('');

  // ==================== 4. USER PERSONA STATE ====================
  const [personasEnabled, setPersonasEnabled] = useState(true);
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [personaSearch, setPersonaSearch] = useState('');
  const [personaTitleDraft, setPersonaTitleDraft] = useState('');
  const [personaNameDraft, setPersonaNameDraft] = useState('');
  const [personaDescDraft, setPersonaDescDraft] = useState('');
  const [personaAvatarDraft, setPersonaAvatarDraft] = useState<string | null>(null);
  const personaFileRef = useRef<HTMLInputElement>(null);

  // ==================== 5. MEMORY & AUTO-SUMMARY STATE ====================
  const [memoryDraft, setMemoryDraft] = useState('');
  const [summaryModelId, setSummaryModelId] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);

  // ==================== 6. SCENARIO, PLACES/TIME & MULTI-CHAT LOOP STATE ====================
  const [roomTitleDraft, setRoomTitleDraft] = useState('');
  const [scenarioDraft, setScenarioDraft] = useState('');
  const [turnStrategyDraft, setTurnStrategyDraft] = useState<Room['turnStrategy']>('round_robin');
  const [cooldownDraft, setCooldownDraft] = useState(3000);
  const [maxAutoTurnsDraft, setMaxAutoTurnsDraft] = useState(8);
  const [contextLimitDraft, setContextLimitDraft] = useState(30);

  // Place / Sub-Place & Time of Day drafts
  const [currentPlaceNameDraft, setCurrentPlaceNameDraft] = useState('Main Location');
  const [currentSubPlaceIdDraft, setCurrentSubPlaceIdDraft] = useState<string | null>(null);
  const [subPlacesDraft, setSubPlacesDraft] = useState<RoomSubPlace[]>([]);
  const [currentTimeOfDayDraft, setCurrentTimeOfDayDraft] = useState<TimeOfDay>('night');
  const [customTimeLabelDraft, setCustomTimeLabelDraft] = useState('');
  const [newPlaceNameInput, setNewPlaceNameInput] = useState('');

  // Dynamic Background AI Image Provider drafts
  const [imageProviderDraft, setImageProviderDraft] =
    useState<ImageGenerationProvider>('pollinations');
  const [imageBaseUrlDraft, setImageBaseUrlDraft] = useState('https://api.openai.com/v1');
  const [imageApiKeyDraft, setImageApiKeyDraft] = useState('');
  const [imageModelDraft, setImageModelDraft] = useState('dall-e-3');
  const [autoGenerateBackgroundsDraft, setAutoGenerateBackgroundsDraft] = useState(true);

  // ==================== 7. LOREBOOK STATE ====================
  const [activeRoomLorebookIds, setActiveRoomLorebookIds] = useState<string[]>([]);
  const [selectedLorebookId, setSelectedLorebookId] = useState<string | null>(null);
  const [lorebookTitleDraft, setLorebookTitleDraft] = useState('');
  const [lorebookDescDraft, setLorebookDescDraft] = useState('');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryTitleDraft, setEntryTitleDraft] = useState('');
  const [entryKeywordsDraft, setEntryKeywordsDraft] = useState('');
  const [entryContentDraft, setEntryContentDraft] = useState('');
  const [entryConstantDraft, setEntryConstantDraft] = useState(false);
  const [entryEnabledDraft, setEntryEnabledDraft] = useState(true);
  const [entryPositionDraft, setEntryPositionDraft] =
    useState<LorebookEntry['insertionPosition']>('after_scenario');

  const triggerToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 1800);
  };

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Hydrate unified settings
  const loadSettingsData = async () => {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const payload: UnifiedSettingsPayload = await res.json();
    setData(payload);

    const s = payload.settings;
    setBaseUrl(s.baseUrl);
    setApiKey(s.apiKey);
    setSelectedModelId(s.defaultModel);
    setUseMockFallback(s.useMockFallback);
    setMaxTokens(s.maxTokens);
    setTemperature(s.temperature);
    setTopP(s.topP);
    setTopK(s.topK);
    setRepetitionPenalty(s.repetitionPenalty);
    setMinP(s.minP);
    setFrequencyPenalty(s.frequencyPenalty);
    setPresencePenalty(s.presencePenalty);
    setSelectedSpId(s.activeSystemPromptId);
    setPersonasEnabled(s.personasEnabled);
    setSelectedPersonaId(s.activePersonaId);
    setSelectedPresetId(s.activePresetId);
    setImageProviderDraft(s.imageProvider || 'pollinations');
    setImageBaseUrlDraft(s.imageBaseUrl || 'https://api.openai.com/v1');
    setImageApiKeyDraft(s.imageApiKey || '');
    setImageModelDraft(s.imageModel || 'dall-e-3');
    setAutoGenerateBackgroundsDraft(s.autoGenerateBackgrounds ?? true);

    try {
      setFavoriteModels(JSON.parse(s.favoriteModelsJson || '[]'));
    } catch {
      setFavoriteModels([]);
    }

    const activeSp =
      payload.systemPrompts.find((sp) => sp.id === s.activeSystemPromptId) ??
      payload.systemPrompts[0];
    if (activeSp) {
      setSpTitleDraft(activeSp.title);
      setSpContentDraft(activeSp.content);
    }

    const activeP =
      payload.userPersonas.find((p) => p.id === s.activePersonaId) ??
      payload.userPersonas[0];
    if (activeP) {
      setSelectedPersonaId(activeP.id);
      setPersonaTitleDraft(activeP.title);
      setPersonaNameDraft(activeP.name);
      setPersonaDescDraft(activeP.description);
      setPersonaAvatarDraft(activeP.avatarUrl ?? null);
    }

    if (payload.lorebooks.length > 0 && !selectedLorebookId) {
      const firstLb = payload.lorebooks[0];
      setSelectedLorebookId(firstLb.id);
      setLorebookTitleDraft(firstLb.title);
      setLorebookDescDraft(firstLb.description || '');
      if (firstLb.entries.length > 0) {
        const firstEntry = firstLb.entries[0];
        setSelectedEntryId(firstEntry.id);
        setEntryTitleDraft(firstEntry.title);
        setEntryKeywordsDraft(firstEntry.keywords);
        setEntryContentDraft(firstEntry.content);
        setEntryConstantDraft(firstEntry.isConstant);
        setEntryEnabledDraft(firstEntry.isEnabled);
        setEntryPositionDraft(firstEntry.insertionPosition);
      }
    } else if (selectedLorebookId) {
      const currentLb = payload.lorebooks.find((lb) => lb.id === selectedLorebookId);
      if (currentLb) {
        setLorebookTitleDraft(currentLb.title);
        setLorebookDescDraft(currentLb.description || '');
      }
    }
  };

  const fetchProviderModels = async (customBaseUrl?: string, customApiKey?: string) => {
    setIsLoadingModels(true);
    setModelNotice(null);
    try {
      const params = new URLSearchParams();
      if (customBaseUrl ?? baseUrl) params.set('baseUrl', customBaseUrl ?? baseUrl);
      if (customApiKey !== undefined ? customApiKey : apiKey) {
        params.set('apiKey', customApiKey !== undefined ? customApiKey : apiKey);
      }
      const res = await fetch(`/api/models?${params.toString()}`);
      const json = await res.json();
      setProviderModels(json.models ?? []);
      if (json.notice) setModelNotice(json.notice);
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadSettingsData();
    fetchProviderModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Hydrate room-scoped fields (Memory, Scenario, Places/Sub-Places, Time, Lorebook bindings)
  useEffect(() => {
    if (!activeRoom) return;
    setMemoryDraft(activeRoom.memoryBox || '');
    setSummaryModelId(activeRoom.summaryModelId || selectedModelId || 'gpt-4o-mini');
    setRoomTitleDraft(activeRoom.title);
    setScenarioDraft(activeRoom.scenarioPrompt || '');
    setTurnStrategyDraft(activeRoom.turnStrategy);
    setCooldownDraft(activeRoom.cooldownMs);
    setMaxAutoTurnsDraft(activeRoom.maxAutoTurns);
    setContextLimitDraft(activeRoom.contextWindowLimit);
    setCurrentPlaceNameDraft(activeRoom.currentPlaceName || 'Main Location');
    setCurrentSubPlaceIdDraft(activeRoom.currentSubPlaceId || null);
    setCurrentTimeOfDayDraft(activeRoom.currentTimeOfDay || 'night');
    setCustomTimeLabelDraft(activeRoom.customTimeLabel || '');
    try {
      const parsedSubs = JSON.parse(activeRoom.subPlacesJson || '[]');
      setSubPlacesDraft(Array.isArray(parsedSubs) ? parsedSubs : []);
    } catch {
      setSubPlacesDraft([]);
    }
    try {
      setActiveRoomLorebookIds(JSON.parse(activeRoom.activeLorebookIdsJson || '[]'));
    } catch {
      setActiveRoomLorebookIds([]);
    }
  }, [activeRoom, selectedModelId]);

  const filteredModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    return providerModels.filter((m) => {
      if (onlyFavorites && !favoriteModels.includes(m.id)) return false;
      if (!q) return true;
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description && m.description.toLowerCase().includes(q))
      );
    });
  }, [providerModels, modelSearch, onlyFavorites, favoriteModels]);

  const activePreset = useMemo(() => {
    return (
      PROVIDER_PRESETS.find((p) => p.baseUrl === baseUrl) ||
      (baseUrl.includes('anthropic.com')
        ? PROVIDER_PRESETS.find((p) => p.id === 'claude')
        : baseUrl.includes('generativelanguage.googleapis.com')
        ? PROVIDER_PRESETS.find((p) => p.id === 'gemini')
        : baseUrl.includes('openrouter.ai')
        ? PROVIDER_PRESETS.find((p) => p.id === 'openrouter')
        : baseUrl.includes('localhost:11434')
        ? PROVIDER_PRESETS.find((p) => p.id === 'ollama')
        : baseUrl.includes('localhost:1234')
        ? PROVIDER_PRESETS.find((p) => p.id === 'lmstudio')
        : PROVIDER_PRESETS.find((p) => p.id === 'custom_openai')) ||
      PROVIDER_PRESETS[0]
    );
  }, [baseUrl]);

  if (!isOpen || !data) return null;

  // ==================== HANDLERS ====================
  const handleSaveModelAndSamplers = async () => {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl,
        apiKey,
        defaultModel: selectedModelId,
        useMockFallback,
        maxTokens,
        temperature,
        topP,
        topK,
        repetitionPenalty,
        minP,
        frequencyPenalty,
        presencePenalty,
        favoriteModelsJson: JSON.stringify(favoriteModels),
      }),
    });
    await loadSettingsData();
    onSettingsChanged();
    triggerToast('Model & Tuning Saved');
  };

  const handleResetSamplers = () => {
    setMaxTokens(300);
    setTemperature(0.75);
    setTopP(0.92);
    setTopK(100);
    setRepetitionPenalty(1.05);
    setMinP(0.05);
    setFrequencyPenalty(0);
    setPresencePenalty(0);
  };

  const toggleFavoriteModel = (modelId: string) => {
    setFavoriteModels((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId]
    );
  };

  const handleSelectSystemPrompt = async (sp: SystemPromptPreset) => {
    setSelectedSpId(sp.id);
    setSpTitleDraft(sp.title);
    setSpContentDraft(sp.content);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeSystemPromptId: sp.id }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
    }
    onSettingsChanged();
    triggerToast(`Active Prompt: ${sp.title}`);
  };

  const handleSaveSystemPrompt = async () => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_system_prompt',
        id: selectedSpId,
        title: spTitleDraft,
        content: spContentDraft,
      }),
    });
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeSystemPromptId: selectedSpId }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
    }
    onSettingsChanged();
    triggerToast('System Prompt Saved');
  };

  const handleCreateSystemPrompt = async () => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_system_prompt',
        title: 'Custom Roleplay Prompt',
        content: "Write {{char}}'s next response in a role-play with {{user}}.",
      }),
    });
    const updated: UnifiedSettingsPayload = await res.json();
    setData(updated);
    const newest = updated.systemPrompts[updated.systemPrompts.length - 1];
    if (newest) {
      handleSelectSystemPrompt(newest);
    }
  };

  const handleApplySamplerPreset = async (preset: SamplerPreset) => {
    setSelectedPresetId(preset.id);
    setTemperature(preset.temperature);
    setMaxTokens(preset.maxTokens);
    setTopP(preset.topP);
    setTopK(preset.topK);
    setMinP(preset.minP);
    setRepetitionPenalty(preset.repetitionPenalty);
    setFrequencyPenalty(preset.frequencyPenalty);
    setPresencePenalty(preset.presencePenalty);
    if (preset.systemPromptId) {
      setSelectedSpId(preset.systemPromptId);
    }

    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activePresetId: preset.id,
        temperature: preset.temperature,
        maxTokens: preset.maxTokens,
        topP: preset.topP,
        topK: preset.topK,
        minP: preset.minP,
        repetitionPenalty: preset.repetitionPenalty,
        frequencyPenalty: preset.frequencyPenalty,
        presencePenalty: preset.presencePenalty,
        activeSystemPromptId: preset.systemPromptId ?? selectedSpId,
      }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
    }
    onSettingsChanged();
    triggerToast(`Applied Preset: ${preset.title}`);
  };

  const handleCreateSamplerPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetTitle.trim()) return;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_sampler_preset',
        title: newPresetTitle.trim(),
        description: newPresetDesc.trim() || `Temp ${temperature}, Top-P ${topP}`,
        temperature,
        maxTokens,
        topP,
        topK,
        minP,
        repetitionPenalty,
        frequencyPenalty,
        presencePenalty,
        systemPromptId: selectedSpId,
      }),
    });
    setNewPresetTitle('');
    setNewPresetDesc('');
    await loadSettingsData();
    triggerToast('Preset Created');
  };

  const handleSelectPersona = async (p: UserPersona) => {
    setSelectedPersonaId(p.id);
    setPersonaTitleDraft(p.title);
    setPersonaNameDraft(p.name);
    setPersonaDescDraft(p.description);
    setPersonaAvatarDraft(p.avatarUrl ?? null);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePersonaId: p.id }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
    }
    if (activeRoom) {
      await onUpdateRoom({ userDisplayName: p.name });
    }
    onSettingsChanged();
    triggerToast(`Active Persona: ${p.title}`);
  };

  const handleUploadPersonaAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/uploads/avatar', { method: 'POST', body: formData });
    if (res.ok) {
      const json = await res.json();
      setPersonaAvatarDraft(json.avatarUrl);
    }
  };

  const handleSavePersona = async () => {
    if (!selectedPersonaId) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_persona',
        id: selectedPersonaId,
        title: personaTitleDraft,
        name: personaNameDraft,
        description: personaDescDraft,
        avatarUrl: personaAvatarDraft,
      }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
    }
    if (activeRoom && personasEnabled) {
      await onUpdateRoom({ userDisplayName: personaNameDraft });
    }
    onSettingsChanged();
    triggerToast('Persona Saved');
  };

  const handleCreatePersona = async () => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_persona',
        title: 'New User Persona',
        name: 'Traveler',
        description: '{{user}} is an observant participant in the story.',
      }),
    });
    const updated: UnifiedSettingsPayload = await res.json();
    setData(updated);
    const newest = updated.userPersonas[updated.userPersonas.length - 1];
    if (newest) {
      handleSelectPersona(newest);
    }
  };

  const handleSaveMemoryBox = async () => {
    if (!activeRoom) return;
    await onUpdateRoom({
      memoryBox: memoryDraft,
      summaryModelId,
    });
    triggerToast('Memory Box Saved');
  };

  const handleSummarizeRoomNow = async () => {
    if (!activeRoom) return;
    setIsSummarizing(true);
    try {
      const res = await fetch(`/api/rooms/${activeRoom.id}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: summaryModelId }),
      });
      const json = await res.json();
      if (res.ok && json.memoryBox) {
        setMemoryDraft(json.memoryBox);
        onSettingsChanged();
        triggerToast('Conversation Summarized into Memory!');
      } else if (json.error) {
        triggerToast(json.error);
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSaveScenarioAndLoop = async () => {
    if (!activeRoom) return;
    await onUpdateRoom({
      title: roomTitleDraft.trim() || activeRoom.title,
      scenarioPrompt: scenarioDraft,
      turnStrategy: turnStrategyDraft,
      cooldownMs: Number(cooldownDraft),
      maxAutoTurns: Number(maxAutoTurnsDraft),
      contextWindowLimit: Number(contextLimitDraft),
    });
    triggerToast('Scenario & Loop Rules Saved');
  };

  const handleSavePlacesAndTime = async () => {
    if (!activeRoom) return;
    const activeSp =
      subPlacesDraft.find((sp) => sp.id === currentSubPlaceIdDraft) ??
      subPlacesDraft[0] ??
      null;
    const resolvedPlaceName =
      activeSp?.parentPlaceName?.trim() ||
      currentPlaceNameDraft.trim() ||
      'Main Location';

    await onUpdateRoom({
      currentPlaceName: resolvedPlaceName,
      currentSubPlaceId: activeSp?.id ?? null,
      subPlacesJson: JSON.stringify(subPlacesDraft),
      currentTimeOfDay: currentTimeOfDayDraft,
      customTimeLabel: customTimeLabelDraft.trim(),
    });
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageProvider: imageProviderDraft,
        imageBaseUrl: imageBaseUrlDraft,
        imageApiKey: imageApiKeyDraft,
        imageModel: imageModelDraft,
        autoGenerateBackgrounds: autoGenerateBackgroundsDraft,
      }),
    });
    await loadSettingsData();
    onSettingsChanged();
    triggerToast('Places, Sub-Places, Time & Background Settings Saved');
  };

  const handleToggleRoomLorebook = async (lbId: string) => {
    if (!activeRoom) return;
    const nextIds = activeRoomLorebookIds.includes(lbId)
      ? activeRoomLorebookIds.filter((id) => id !== lbId)
      : [...activeRoomLorebookIds, lbId];
    setActiveRoomLorebookIds(nextIds);
    await onUpdateRoom({
      activeLorebookIdsJson: JSON.stringify(nextIds),
    });
  };

  const handleSelectLoreEntry = (entry: LorebookEntry) => {
    setSelectedEntryId(entry.id);
    setEntryTitleDraft(entry.title);
    setEntryKeywordsDraft(entry.keywords);
    setEntryContentDraft(entry.content);
    setEntryConstantDraft(entry.isConstant);
    setEntryEnabledDraft(entry.isEnabled);
    setEntryPositionDraft(entry.insertionPosition);
  };

  const handleCreateLorebook = async () => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_lorebook',
        title: 'New World Lorebook',
        description: 'Custom world info & keyword triggers',
      }),
    });
    const updated: UnifiedSettingsPayload = await res.json();
    setData(updated);
    const newest = updated.lorebooks[updated.lorebooks.length - 1];
    if (newest) {
      setSelectedLorebookId(newest.id);
      setLorebookTitleDraft(newest.title);
      setLorebookDescDraft(newest.description || '');
      setSelectedEntryId(null);
    }
  };

  const handleSaveLorebook = async () => {
    if (!selectedLorebookId || !lorebookTitleDraft.trim()) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_lorebook',
        id: selectedLorebookId,
        title: lorebookTitleDraft.trim(),
        description: lorebookDescDraft.trim(),
      }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
      onSettingsChanged();
      triggerToast('Lorebook Name Saved');
    }
  };

  const handleCreateLoreEntry = async () => {
    if (!selectedLorebookId) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_lorebook_entry',
        lorebookId: selectedLorebookId,
        title: 'New Lore Entry',
        keywords: 'keyword1, keyword2',
        content: 'Describe the lore, location, item, or faction that triggers when these keywords appear.',
        isConstant: false,
        isEnabled: true,
        insertionPosition: 'after_scenario',
      }),
    });
    const updated: UnifiedSettingsPayload = await res.json();
    setData(updated);
    const lb = updated.lorebooks.find((l) => l.id === selectedLorebookId);
    const newest = lb?.entries[lb.entries.length - 1];
    if (newest) {
      handleSelectLoreEntry(newest);
    }
  };

  const handleSaveLoreEntry = async () => {
    if (!selectedEntryId) return;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update_lorebook_entry',
        id: selectedEntryId,
        title: entryTitleDraft,
        keywords: entryKeywordsDraft,
        content: entryContentDraft,
        isConstant: entryConstantDraft,
        isEnabled: entryEnabledDraft,
        insertionPosition: entryPositionDraft,
      }),
    });
    if (res.ok) {
      const updated: UnifiedSettingsPayload = await res.json();
      setData(updated);
      onSettingsChanged();
    }
    triggerToast('Lorebook Entry Saved');
  };

  // Active summaries for Left Navigation column
  const activeSpObj = data.systemPrompts.find((sp) => sp.id === selectedSpId);
  const activePresetObj = data.samplerPresets.find((p) => p.id === selectedPresetId);
  const activePersonaObj = data.userPersonas.find((p) => p.id === selectedPersonaId);
  const selectedLorebookObj = data.lorebooks.find((lb) => lb.id === selectedLorebookId);

  const navItems: Array<{
    id: TavernSettingsTab;
    label: string;
    status: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'model',
      label: 'Model',
      status: selectedModelId.split('/').pop() || 'gpt-4o-mini',
      icon: <Cpu className="h-4 w-4" />,
    },
    {
      id: 'system_prompt',
      label: 'System Prompt',
      status: activeSpObj?.title || 'Roleplay',
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: 'presets',
      label: 'Presets',
      status: activePresetObj?.title || 'Custom',
      icon: <Sliders className="h-4 w-4" />,
    },
    {
      id: 'persona',
      label: 'Persona',
      status: personasEnabled ? activePersonaObj?.name || 'Active' : 'Disabled',
      icon: <UserCheck className="h-4 w-4" />,
    },
    {
      id: 'memory',
      label: 'Memory',
      status: memoryDraft.trim() ? 'Active' : 'Empty',
      icon: <Brain className="h-4 w-4" />,
    },
    {
      id: 'places_time',
      label: 'Places & Time',
      status: `${
        (
          subPlacesDraft.find((sp) => sp.id === currentSubPlaceIdDraft) ??
          subPlacesDraft[0]
        )?.name || currentPlaceNameDraft
      } • ${currentTimeOfDayDraft}`,
      icon: <MapPin className="h-4 w-4" />,
    },
    {
      id: 'scenario',
      label: 'Scenario & Loop',
      status: turnStrategyDraft === 'round_robin' ? 'Round-Robin' : 'Dynamic',
      icon: <Clapperboard className="h-4 w-4" />,
    },
    {
      id: 'lorebook',
      label: 'Lorebook',
      status: `${activeRoomLorebookIds.length} Active`,
      icon: <BookOpen className="h-4 w-4" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm">
      <div className="relative flex h-[88vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-700/90 bg-slate-950 text-slate-100 shadow-2xl">
        {/* Toast Notification */}
        {saveToast && (
          <div className="absolute bottom-5 right-6 z-50 flex items-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-950/95 px-4 py-2 text-xs font-semibold text-emerald-200 shadow-lg">
            <Check className="h-4 w-4 text-emerald-400" />
            {saveToast}
          </div>
        )}

        {/* ==================== COLUMN 1: TAVERN CHAT SETTINGS LEFT NAV ==================== */}
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/90">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h2 className="text-sm font-bold tracking-tight text-white">Chat Settings</h2>
            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
              Tavern
            </span>
          </div>

          <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
            {navItems.map((item) => {
              const isSelected = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/20 text-white border-l-2 border-indigo-400 shadow-sm'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-2.5 text-xs font-semibold">
                    <span className={isSelected ? 'text-indigo-400' : 'text-slate-500'}>
                      {item.icon}
                    </span>
                    {item.label}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 max-w-[95px]">
                    <span className="truncate">{item.status}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-3 text-[11px] text-slate-500">
            Supports <code className="text-indigo-300">{'{{char}}'}</code> &{' '}
            <code className="text-indigo-300">{'{{user}}'}</code> macros across all prompts, personas, and lorebooks.
          </div>
        </aside>

        {/* ==================== COLUMN 2 & 3: DYNAMIC TAVERN CONTENT PANES ==================== */}

        {/* TAB 1: MODEL & TUNING */}
        {activeTab === 'model' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: Provider Connection + Fetched Model List */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white">Model</h3>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                    {providerModels.length > 0
                      ? `${filteredModels.length} remote + 1 local`
                      : '1 local active'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {providerModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOnlyFavorites((v) => !v)}
                      className={`rounded-lg border p-1.5 transition cursor-pointer ${
                        onlyFavorites
                          ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                      title="Filter Favorite Models"
                    >
                      <Heart className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fetchProviderModels(baseUrl, apiKey)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-indigo-500 hover:text-white cursor-pointer"
                    title="Fetch live model list from API Provider"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    Fetch
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowApiConnectionBox((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium cursor-pointer ${
                      showApiConnectionBox
                        ? 'border-indigo-500 bg-indigo-950/70 text-indigo-200'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                    }`}
                  >
                    <Server className="h-3.5 w-3.5" />
                    API Endpoint
                  </button>
                </div>
              </div>

              {/* Collapsible API Provider Connection Box */}
              {showApiConnectionBox && (
                <div className="border-b border-slate-800 bg-slate-900/90 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-slate-300">
                        Provider Endpoint
                      </label>
                      <span className="text-[10px] text-indigo-400 font-mono">
                        {activePreset.id === 'custom_openai' ? 'OpenAI-Compatible' : activePreset.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PROVIDER_PRESETS.map((p) => {
                        const isCurrent = activePreset.id === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setBaseUrl(p.baseUrl);
                              if (selectedModelId !== 'simulated') {
                                setSelectedModelId(p.defaultModel);
                              }
                              fetchProviderModels(p.baseUrl, apiKey);
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
                              isCurrent
                                ? 'border-indigo-500 bg-indigo-950 text-indigo-200 shadow-sm'
                                : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                            }`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 pt-0.5">{activePreset.description}</p>
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Base URL</label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-slate-400">
                        API Key (Optional for Ollama / LM Studio / Simulated Mode)
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={activePreset.keyPlaceholder}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => fetchProviderModels(baseUrl, apiKey)}
                        disabled={isLoadingModels}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer transition shadow"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                        Fetch
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-0.5">
                    <input
                      type="checkbox"
                      checked={useMockFallback}
                      onChange={(e) => setUseMockFallback(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>Enable Local Simulated Fallback when offline or API call fails</span>
                  </label>
                </div>
              )}

              {/* Models List Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {modelNotice && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-200/90">
                    <p className="font-semibold text-amber-300">Status Notice:</p>
                    <p className="mt-0.5 leading-relaxed">{modelNotice}</p>
                  </div>
                )}

                {/* 1. Local Simulated Roleplay Engine Card */}
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-1 mb-1.5">
                    Default / Built-In Engine
                  </div>
                  <div
                    onClick={() => setSelectedModelId('simulated')}
                    className={`group rounded-xl border p-3.5 transition cursor-pointer ${
                      selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)
                        ? 'border-emerald-500/80 bg-emerald-950/30 ring-1 ring-emerald-500/30 shadow-md shadow-emerald-950/20'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                            selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)
                              ? 'border-emerald-400'
                              : 'border-slate-600'
                          }`}
                        >
                          {(selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)) && (
                            <div className="h-2 w-2 rounded-full bg-emerald-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white">Local Simulated Roleplay Engine</span>
                            <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold">
                              100% Free • Offline
                            </span>
                          </div>
                        </div>
                      </div>

                      {(selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)) && (
                        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                          Active
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                      Built-in simulated roleplay engine that generates in-character replies locally in real time. Works offline with zero API keys and no GPU requirements.
                    </p>
                  </div>
                </div>

                {/* 2. Remote Provider Models */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Remote Provider Models ({activePreset.label})
                    </div>
                    {providerModels.length > 0 && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {filteredModels.length} models
                      </span>
                    )}
                  </div>

                  {/* Empty state when no models fetched */}
                  {providerModels.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-5 text-center">
                      <Sparkles className="mx-auto h-6 w-6 text-indigo-400/80 mb-2" />
                      <h4 className="text-xs font-semibold text-slate-300">
                        {!apiKey && !activePreset.id.includes('ollama') && !activePreset.id.includes('lmstudio')
                          ? `No ${activePreset.label} Models Loaded`
                          : 'No Models Fetched Yet'}
                      </h4>
                      <p className="mt-1 text-[11px] text-slate-400 max-w-sm mx-auto leading-relaxed">
                        {!apiKey && !activePreset.id.includes('ollama') && !activePreset.id.includes('lmstudio')
                          ? `Enter your API key in the connection box above and click "Fetch" to load remote models from ${activePreset.label}. Until an API key is provided, the Local Simulated Engine above will respond.`
                          : `Click "Fetch" above to query ${baseUrl} for available models.`}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Search & Custom Model Input */}
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="Search fetched models or type custom model ID..."
                          className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>

                      {modelSearch.trim() &&
                        !filteredModels.some((m) => m.id === modelSearch.trim()) && (
                          <button
                            type="button"
                            onClick={() => setSelectedModelId(modelSearch.trim())}
                            className="flex w-full items-center justify-between rounded-xl border border-dashed border-indigo-500/60 bg-indigo-950/30 p-3 text-left text-xs text-indigo-200 cursor-pointer"
                          >
                            <span>
                              Use custom model ID: <strong>{modelSearch.trim()}</strong>
                            </span>
                            <Plus className="h-4 w-4" />
                          </button>
                        )}

                      <div className="space-y-2 pt-1">
                        {filteredModels.map((m) => {
                          const isActive = selectedModelId === m.id;
                          const isFav = favoriteModels.includes(m.id);
                          return (
                            <div
                              key={m.id}
                              onClick={() => setSelectedModelId(m.id)}
                              className={`group rounded-xl border p-3.5 transition cursor-pointer ${
                                isActive
                                  ? 'border-indigo-400 bg-indigo-950/35 shadow-md shadow-indigo-950/30'
                                  : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div
                                    className={`h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                                      isActive ? 'border-indigo-400' : 'border-slate-600'
                                    }`}
                                  >
                                    {isActive && <div className="h-2 w-2 rounded-full bg-indigo-400" />}
                                  </div>
                                  <span className="truncate text-xs font-bold text-white">{m.name}</span>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isActive && (
                                    <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                                      Active
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavoriteModel(m.id);
                                    }}
                                    className={`p-1 rounded hover:bg-slate-800 cursor-pointer ${
                                      isFav ? 'text-rose-400' : 'text-slate-500'
                                    }`}
                                  >
                                    <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
                                  </button>
                                </div>
                              </div>

                              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                                <span>ID: {m.id}</span>
                                {m.contextLength && (
                                  <span>• Context: {Math.round(m.contextLength / 1000)}k</span>
                                )}
                              </div>
                              {m.description && (
                                <p className="mt-1 text-xs text-slate-400 line-clamp-2">{m.description}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Model Tuning / Samplers */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="truncate text-sm font-bold text-white">
                    {selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)
                      ? 'Local Simulated Roleplay Engine'
                      : selectedModelId}
                  </h3>
                  {(selectedModelId === 'simulated' || (!apiKey && providerModels.length === 0)) && (
                    <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold shrink-0">
                      Offline Mode
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleResetSamplers}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Response Tokens */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-200">
                      Response tokens (50 - 2000)
                    </label>
                    <input
                      type="number"
                      min={50}
                      max={2000}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-center font-mono text-xs text-white"
                    />
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={2000}
                    step={10}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Temperature */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-200">
                      Temperature (0 - 2)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.05}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-center font-mono text-xs text-white"
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Advanced Settings Accordion */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedSamplers((v) => !v)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-slate-200 cursor-pointer"
                  >
                    <span>Advanced settings</span>
                    {showAdvancedSamplers ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </button>

                  {showAdvancedSamplers && (
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-5 pt-3 border-t border-slate-800/80">
                      {/* Top P */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Top P (0 - 1)</span>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={topP}
                            onChange={(e) => setTopP(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={topP}
                          onChange={(e) => setTopP(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      {/* Top K */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Top K (0 - 100)</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={topK}
                            onChange={(e) => setTopK(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={topK}
                          onChange={(e) => setTopK(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      {/* Repetition Penalty */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Repetition Penalty (1 - 2)</span>
                          <input
                            type="number"
                            min={1}
                            max={2}
                            step={0.01}
                            value={repetitionPenalty}
                            onChange={(e) => setRepetitionPenalty(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={2}
                          step={0.01}
                          value={repetitionPenalty}
                          onChange={(e) => setRepetitionPenalty(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      {/* Min P */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Min P (0 - 1)</span>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={minP}
                            onChange={(e) => setMinP(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={minP}
                          onChange={(e) => setMinP(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      {/* Frequency Penalty */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Frequency Penalty (-2 - 2)</span>
                          <input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.05}
                            value={frequencyPenalty}
                            onChange={(e) => setFrequencyPenalty(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={-2}
                          max={2}
                          step={0.05}
                          value={frequencyPenalty}
                          onChange={(e) => setFrequencyPenalty(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>

                      {/* Presence Penalty */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-slate-300">Presence Penalty (-2 - 2)</span>
                          <input
                            type="number"
                            min={-2}
                            max={2}
                            step={0.05}
                            value={presencePenalty}
                            onChange={(e) => setPresencePenalty(Number(e.target.value))}
                            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-center font-mono text-xs text-white"
                          />
                        </div>
                        <input
                          type="range"
                          min={-2}
                          max={2}
                          step={0.05}
                          value={presencePenalty}
                          onChange={(e) => setPresencePenalty(Number(e.target.value))}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800 p-4">
                <button
                  type="button"
                  onClick={handleSaveModelAndSamplers}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                >
                  Save Model & Tuning
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SYSTEM PROMPT */}
        {activeTab === 'system_prompt' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: System Prompt Presets List */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <h3 className="text-sm font-bold text-white">System Prompt</h3>
                <button
                  type="button"
                  onClick={handleCreateSystemPrompt}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Prompt
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {data.systemPrompts.map((sp) => {
                  const isSelected = sp.id === selectedSpId;
                  return (
                    <div
                      key={sp.id}
                      onClick={() => handleSelectSystemPrompt(sp)}
                      className={`rounded-xl border p-3.5 transition cursor-pointer ${
                        isSelected
                          ? 'border-indigo-400 bg-indigo-950/35 shadow-md'
                          : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-indigo-400' : 'border-slate-600'
                          }`}
                        >
                          {isSelected && <div className="h-2 w-2 rounded-full bg-indigo-400" />}
                        </div>
                        <span className="text-xs font-bold text-white">{sp.title}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-4">
                        {sp.content}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: System Prompt Editor */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">{spTitleDraft || 'System Prompt'}</h3>
                <div className="flex items-center gap-2">
                  {activeSpObj && !activeSpObj.isBuiltin && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'delete_system_prompt',
                            id: activeSpObj.id,
                          }),
                        });
                        await loadSettingsData();
                      }}
                      className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-950/50 cursor-pointer"
                      title="Delete custom prompt"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Preset Title
                  </label>
                  <input
                    type="text"
                    value={spTitleDraft}
                    onChange={(e) => setSpTitleDraft(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    System Prompt Directive (Supports <code className="text-indigo-300">{'{{char}}'}</code> and <code className="text-indigo-300">{'{{user}}'}</code>)
                  </label>
                  <div className="relative">
                    <textarea
                      rows={11}
                      maxLength={3500}
                      value={spContentDraft}
                      onChange={(e) => setSpContentDraft(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3.5 text-xs text-slate-100 leading-relaxed focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="absolute bottom-2.5 right-3 text-[10px] font-mono text-slate-500">
                      {spContentDraft.length}/3500
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    This directive defines how every AI character structures and styles their response, combined automatically with each character&apos;s individual persona.
                  </p>
                </div>
              </div>

              <div className="border-t border-slate-800 p-4">
                <button
                  type="button"
                  onClick={handleSaveSystemPrompt}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                >
                  Save System Prompt
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: SAMPLER PRESETS */}
        {activeTab === 'presets' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: Saved Sampler Presets */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <h3 className="text-sm font-bold text-white">Sampler & Prompt Presets</h3>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {data.samplerPresets.map((preset) => {
                  const isSelected = preset.id === selectedPresetId;
                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleApplySamplerPreset(preset)}
                      className={`rounded-xl border p-3.5 transition cursor-pointer ${
                        isSelected
                          ? 'border-indigo-400 bg-indigo-950/35 shadow-md'
                          : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{preset.title}</span>
                        <div className="flex items-center gap-1.5">
                          {isSelected && (
                            <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                              Active
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await fetch('/api/settings', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  action: 'delete_sampler_preset',
                                  id: preset.id,
                                }),
                              });
                              await loadSettingsData();
                            }}
                            className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{preset.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-300">
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          Temp {preset.temperature}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          Tokens {preset.maxTokens}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          Top-P {preset.topP}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5">
                          RepPen {preset.repetitionPenalty}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Save Current Tuning as Preset */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">Save Current Configuration as Preset</h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleCreateSamplerPreset} className="flex-1 p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Preset Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newPresetTitle}
                    onChange={(e) => setNewPresetTitle(e.target.value)}
                    placeholder="e.g., High-Drama Mystery Preset"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={newPresetDesc}
                    onChange={(e) => setNewPresetDesc(e.target.value)}
                    placeholder="Short note about when to use this preset..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
                  <div className="font-semibold text-slate-200 mb-1">
                    Snapshot of Current Samplers to Save:
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-400 font-mono text-[11px]">
                    <div>Temperature: {temperature}</div>
                    <div>Response Tokens: {maxTokens}</div>
                    <div>Top-P: {topP}</div>
                    <div>Top-K: {topK}</div>
                    <div>Min-P: {minP}</div>
                    <div>Repetition Penalty: {repetitionPenalty}</div>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer"
                >
                  + Save Current Tuning as Preset
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: USER PERSONA */}
        {activeTab === 'persona' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: Enable Personas Toggle & Persona List */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <h3 className="text-sm font-bold text-white">Persona</h3>
                <button
                  type="button"
                  onClick={handleCreatePersona}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Persona
                </button>
              </div>

              <div className="p-3.5 border-b border-slate-800 space-y-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs font-semibold text-slate-200">Enable personas</span>
                  <input
                    type="checkbox"
                    checked={personasEnabled}
                    onChange={async (e) => {
                      const val = e.target.checked;
                      setPersonasEnabled(val);
                      await fetch('/api/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ personasEnabled: val }),
                      });
                      onSettingsChanged();
                    }}
                    className="h-4 w-4 rounded accent-indigo-500"
                  />
                </label>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={personaSearch}
                    onChange={(e) => setPersonaSearch(e.target.value)}
                    placeholder="Search your personas..."
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {data.userPersonas
                  .filter((p) => {
                    const q = personaSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      p.title.toLowerCase().includes(q) ||
                      p.name.toLowerCase().includes(q) ||
                      p.description.toLowerCase().includes(q)
                    );
                  })
                  .map((p) => {
                    const isSelected = p.id === selectedPersonaId;
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPersona(p)}
                        className={`flex items-start gap-3 rounded-xl border p-3.5 transition cursor-pointer ${
                          isSelected
                            ? 'border-indigo-400 bg-indigo-950/35 shadow-md'
                            : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                        }`}
                      >
                        <CharacterAvatar
                          name={p.name}
                          avatarColor="#3b82f6"
                          avatarUrl={p.avatarUrl}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <h4 className="truncate text-xs font-bold text-white">{p.title}</h4>
                            {isSelected && personasEnabled && (
                              <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-indigo-300">
                            Chat Name (<code>{'{{user}}'}</code>): <strong>{p.name}</strong>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                            {p.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Right Column: Persona Editor */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">
                  {personaTitleDraft || 'Edit Persona'}
                </h3>
                <div className="flex items-center gap-2">
                  {data.userPersonas.length > 1 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'delete_persona',
                            id: selectedPersonaId,
                          }),
                        });
                        await loadSettingsData();
                      }}
                      className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-950/50 cursor-pointer"
                      title="Delete persona"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Avatar Upload */}
                <div className="flex items-center gap-4">
                  <div
                    onClick={() => personaFileRef.current?.click()}
                    className="relative cursor-pointer group"
                  >
                    <CharacterAvatar
                      name={personaNameDraft || 'U'}
                      avatarColor="#3b82f6"
                      avatarUrl={personaAvatarDraft}
                      size="xl"
                    />
                    <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 border border-slate-600 text-white group-hover:bg-indigo-600">
                      <Upload className="h-3 w-3" />
                    </span>
                  </div>
                  <input
                    ref={personaFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleUploadPersonaAvatar}
                    className="hidden"
                  />
                  <div className="text-xs text-slate-400">
                    <div className="font-semibold text-slate-200">Persona Portrait</div>
                    <div>JPG, PNG, WebP — Click avatar to upload</div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Title (Profile Label)
                  </label>
                  <input
                    type="text"
                    value={personaTitleDraft}
                    onChange={(e) => setPersonaTitleDraft(e.target.value)}
                    placeholder="e.g., Scotland Yard Inspector"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Name (Your name in chat — replaces <code className="text-indigo-300">{'{{user}}'}</code>)
                  </label>
                  <input
                    type="text"
                    value={personaNameDraft}
                    onChange={(e) => setPersonaNameDraft(e.target.value)}
                    placeholder="Your name in chat"
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Tell about yourself (Injected so characters know who you are)
                  </label>
                  <div className="relative">
                    <textarea
                      rows={6}
                      maxLength={3000}
                      value={personaDescDraft}
                      onChange={(e) => setPersonaDescDraft(e.target.value)}
                      placeholder="Describe your appearance, personality, role, and relationship to {{char}}..."
                      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3.5 text-xs text-white leading-relaxed"
                    />
                    <span className="absolute bottom-2.5 right-3 text-[10px] font-mono text-slate-500">
                      {personaDescDraft.length} / 3000
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-800 p-4">
                <button
                  type="button"
                  onClick={handleSavePersona}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                >
                  Save Persona
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: MEMORY & AUTO-SUMMARY */}
        {activeTab === 'memory' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: Memory Box Preview & Auto-Summary Controls */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60 p-5 space-y-5 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white">
                    Memory Box (Shared Across All Room Characters)
                  </span>
                  {memoryDraft && (
                    <button
                      type="button"
                      onClick={() => setMemoryDraft('')}
                      className="text-xs text-slate-400 hover:text-rose-300 cursor-pointer"
                    >
                      × Clear
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-indigo-500/50 bg-slate-900/90 p-3.5 text-xs text-slate-300 leading-relaxed min-h-[110px] whitespace-pre-wrap">
                  {memoryDraft.trim() || (
                    <span className="italic text-slate-500">
                      Memory Box is currently empty. Type directly in the right panel or click Summarize below.
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800 pt-4 space-y-3">
                <div className="text-xs font-bold text-white">Auto-Summary</div>
                <p className="text-[11px] text-slate-400">
                  Condenses the current multi-character chatroom transcript into key events, clues, and character state, automatically updating the Memory Box.
                </p>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Summary Model</label>
                  <select
                    value={summaryModelId}
                    onChange={(e) => setSummaryModelId(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white"
                  >
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  disabled={isSummarizing || !activeRoom}
                  onClick={handleSummarizeRoomNow}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-2.5 text-xs font-bold text-slate-950 shadow hover:bg-amber-300 disabled:opacity-50 cursor-pointer transition"
                >
                  <Sparkles className="h-4 w-4" />
                  {isSummarizing ? 'Summarizing Conversation...' : 'Summarize Room Transcript Now'}
                </button>
              </div>
            </div>

            {/* Right Column: Full Memory Box Textarea Editor */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">Memory Box</h3>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMemoryDraft(activeRoom?.memoryBox || '')}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 p-6">
                <div className="relative h-full flex flex-col">
                  <textarea
                    maxLength={4000}
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    placeholder="Put anything you want your character(s) to remember here: past events, shared goals, secrets, or learned facts..."
                    className="w-full flex-1 rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs text-slate-100 leading-relaxed focus:border-indigo-500 focus:outline-none resize-none"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Injected universally into all characters in this room</span>
                    <span>{memoryDraft.length}/4000</span>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-800 p-4">
                <button
                  type="button"
                  onClick={handleSaveMemoryBox}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                >
                  Save Memory Box
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: SCENARIO & MULTI-CHARACTER LOOP RULES */}
        {activeTab === 'scenario' && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60 p-5 space-y-4 overflow-y-auto">
              <h3 className="text-sm font-bold text-white">Scenario & Multi-Agent Orchestration</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Configure the physical/temporal starting situation (<code className="text-indigo-300">Scenario</code>) along with how the AI characters take turns interacting in this room.
              </p>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Turn Orchestration Strategy
                  </label>
                  <select
                    value={turnStrategyDraft}
                    onChange={(e) => setTurnStrategyDraft(e.target.value as Room['turnStrategy'])}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                  >
                    <option value="round_robin">Round-Robin (Seat Order #1 → #2 → #3)</option>
                    <option value="dynamic_router">
                      Dynamic Relevance Router (Prioritizes Addressed Character)
                    </option>
                    <option value="manual_only">Manual Trigger Only</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-300">Turn Cooldown Buffer</span>
                    <span className="font-mono text-amber-300">
                      {(cooldownDraft / 1000).toFixed(1)}s
                    </span>
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
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-300">Max Auto-Turns Limit</span>
                    <span className="font-mono text-indigo-300">{maxAutoTurnsDraft} turns</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={25}
                    step={1}
                    value={maxAutoTurnsDraft}
                    onChange={(e) => setMaxAutoTurnsDraft(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-300">
                      Sliding Context Window (Messages Sent)
                    </span>
                    <span className="font-mono text-emerald-300">{contextLimitDraft} msgs</span>
                  </div>
                  <input
                    type="range"
                    min={6}
                    max={80}
                    step={2}
                    value={contextLimitDraft}
                    onChange={(e) => setContextLimitDraft(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </div>

              {activeRoom && onRequestDeleteRoom && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 space-y-2.5">
                  <div className="text-xs font-bold text-rose-300">Danger Zone</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Permanently delete <strong className="text-slate-200">{activeRoom.title}</strong> and all of its messages and turn history. Your characters in the Character Database will not be deleted.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onRequestDeleteRoom(activeRoom.id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-600/20 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-600 hover:text-white cursor-pointer transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete This Chatroom
                  </button>
                </div>
              )}
            </div>

            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">Room Title & Scenario</h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 p-6 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Chatroom Title
                  </label>
                  <input
                    type="text"
                    value={roomTitleDraft}
                    onChange={(e) => setRoomTitleDraft(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Scenario & Setting Prompt (Supports <code className="text-indigo-300">{'{{char}}'}</code>, <code className="text-indigo-300">{'{{user}}'}</code>, <code className="text-emerald-300">{'{{place}}'}</code>, <code className="text-emerald-300">{'{{subplace}}'}</code>, <code className="text-amber-300">{'{{time}}'}</code>)
                  </label>
                  <textarea
                    rows={10}
                    value={scenarioDraft}
                    onChange={(e) => setScenarioDraft(e.target.value)}
                    placeholder="Establish the physical setting, atmosphere, and starting situation..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3.5 text-xs text-slate-100 leading-relaxed"
                  />
                </div>
              </div>

              <div className="border-t border-slate-800 p-4">
                <button
                  type="button"
                  onClick={handleSaveScenarioAndLoop}
                  className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                >
                  Save Scenario & Loop Rules
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6B: DEDICATED PLACES, SUB-PLACES, TIME OF DAY & BACKGROUND STUDIO */}
        {activeTab === 'places_time' && (() => {
          // Group all sub-places by their Main Place (parentPlaceName)
          const placesMap = new Map<string, RoomSubPlace[]>();
          for (const sp of subPlacesDraft) {
            const placeKey = sp.parentPlaceName?.trim() || currentPlaceNameDraft || 'Main Location';
            const arr = placesMap.get(placeKey) ?? [];
            arr.push(sp);
            placesMap.set(placeKey, arr);
          }

          const selectedSubPlace =
            subPlacesDraft.find((sp) => sp.id === currentSubPlaceIdDraft) ??
            subPlacesDraft[0] ??
            null;

          return (
            <div className="flex flex-1 overflow-hidden">
              {/* Middle Column: Time of Day + Main Places & Sub-Places Hierarchy */}
              <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60 overflow-y-auto p-5 space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-400" />
                    Places, Sub-Places & Time of Day
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    A <strong className="text-emerald-300">Main Place</strong> is a building or outdoor setting (e.g., <em>The Palace</em>, <em>Home</em>, <em>Town Park</em>). Inside each Place, add <strong className="text-white">Sub-Places</strong> (e.g., <em>Living Room</em>, <em>Bedroom</em>, <em>Kitchen</em>). All characters in the room know the active Place, Sub-Place, and Time of Day.
                  </p>
                </div>

                {/* Step 1: Time of Day & Clock Card */}
                <div className="rounded-xl border border-amber-500/35 bg-slate-900/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                      <Clock className="h-3.5 w-3.5" />
                      1. Current Time of Day
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Also updates automatically when you narrate e.g. &ldquo;at night&rdquo;
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'dawn', label: '🌅 Dawn', sub: 'Sunrise twilight' },
                        { id: 'morning', label: '☀️ Morning', sub: 'Daylight' },
                        { id: 'noon', label: '🌤️ Noon', sub: 'Midday / Afternoon' },
                        { id: 'sunset', label: '🌇 Sunset', sub: 'Golden hour dusk' },
                        { id: 'night', label: '🌙 Night', sub: 'Evening & lamps' },
                        { id: 'midnight', label: '🌌 Midnight', sub: 'Late night' },
                      ] as Array<{ id: TimeOfDay; label: string; sub: string }>
                    ).map((t) => {
                      const isSelected = currentTimeOfDayDraft === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setCurrentTimeOfDayDraft(t.id)}
                          className={`flex flex-col items-start rounded-xl border p-2.5 text-left transition cursor-pointer ${
                            isSelected
                              ? 'border-amber-400 bg-amber-500/20 text-white shadow-sm'
                              : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <span className="text-xs font-bold">{t.label}</span>
                          <span className="text-[10px] text-slate-400">{t.sub}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Optional Clock / Weather Note (e.g., 1:15 AM, Heavy Rain, Full Moon)
                    </label>
                    <input
                      type="text"
                      value={customTimeLabelDraft}
                      onChange={(e) => setCustomTimeLabelDraft(e.target.value)}
                      placeholder="e.g., 8:30 AM, Sunny Morning"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                </div>

                {/* Step 2: Add a Brand-New Main Place */}
                <div className="rounded-xl border border-emerald-500/35 bg-slate-900/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                      <MapPin className="h-3.5 w-3.5" />
                      2. Places & Sub-Places Hierarchy
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {placesMap.size} Place{placesMap.size === 1 ? '' : 's'} • {subPlacesDraft.length} Sub-Place{subPlacesDraft.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {/* Add New Main Place Bar */}
                  <div className="flex gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
                    <input
                      type="text"
                      value={newPlaceNameInput}
                      onChange={(e) => setNewPlaceNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPlaceNameInput.trim()) {
                          e.preventDefault();
                          const placeTitle = newPlaceNameInput.trim();
                          const newSp: RoomSubPlace = {
                            id: `subplace_${Date.now().toString(36)}`,
                            name: 'Main Area',
                            parentPlaceName: placeTitle,
                            description: `Main area inside ${placeTitle}.`,
                            backgroundsByTime: {},
                          };
                          setSubPlacesDraft((prev) => [...prev, newSp]);
                          setCurrentPlaceNameDraft(placeTitle);
                          setCurrentSubPlaceIdDraft(newSp.id);
                          setNewPlaceNameInput('');
                        }
                      }}
                      placeholder="Type a new Main Place name (e.g., The Palace, Town Park, Guild Hall)..."
                      className="flex-1 bg-transparent px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!newPlaceNameInput.trim()}
                      onClick={() => {
                        const placeTitle = newPlaceNameInput.trim();
                        if (!placeTitle) return;
                        const newSp: RoomSubPlace = {
                          id: `subplace_${Date.now().toString(36)}`,
                          name: 'Main Area',
                          parentPlaceName: placeTitle,
                          description: `Main area inside ${placeTitle}.`,
                          backgroundsByTime: {},
                        };
                        setSubPlacesDraft((prev) => [...prev, newSp]);
                        setCurrentPlaceNameDraft(placeTitle);
                        setCurrentSubPlaceIdDraft(newSp.id);
                        setNewPlaceNameInput('');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40 cursor-pointer transition shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add New Place
                    </button>
                  </div>

                  {/* Grouped Main Places Cards */}
                  <div className="space-y-3">
                    {Array.from(placesMap.entries()).map(([placeName, subList]) => {
                      const isActivePlace = subList.some(
                        (s) => s.id === (currentSubPlaceIdDraft || subPlacesDraft[0]?.id)
                      );
                      return (
                        <div
                          key={placeName}
                          className={`rounded-xl border p-3 space-y-2.5 ${
                            isActivePlace
                              ? 'border-emerald-500/60 bg-emerald-950/15'
                              : 'border-slate-800 bg-slate-950/60'
                          }`}
                        >
                          {/* Main Place Header: Editable Place Name + Add Sub-Place Button */}
                          <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 shrink-0">
                                Place
                              </span>
                              <input
                                type="text"
                                value={placeName}
                                onChange={(e) => {
                                  const newPlaceVal = e.target.value;
                                  setSubPlacesDraft((prev) =>
                                    prev.map((item) =>
                                      (item.parentPlaceName?.trim() || currentPlaceNameDraft) ===
                                      placeName
                                        ? { ...item, parentPlaceName: newPlaceVal }
                                        : item
                                    )
                                  );
                                  if (isActivePlace) {
                                    setCurrentPlaceNameDraft(newPlaceVal);
                                  }
                                }}
                                placeholder="Place Name (e.g., The Palace)"
                                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-bold text-emerald-200 focus:border-emerald-400 focus:outline-none"
                                title="Edit Place Name (automatically updates all Sub-Places inside this Place)"
                              />
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const newSp: RoomSubPlace = {
                                    id: `subplace_${Date.now().toString(36)}`,
                                    name: `New Room ${subList.length + 1}`,
                                    parentPlaceName: placeName,
                                    description: `Area inside ${placeName}.`,
                                    backgroundsByTime: {},
                                  };
                                  setSubPlacesDraft((prev) => [...prev, newSp]);
                                  setCurrentPlaceNameDraft(placeName);
                                  setCurrentSubPlaceIdDraft(newSp.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-600/40 cursor-pointer"
                              >
                                <Plus className="h-3 w-3" />
                                Add Sub-Place
                              </button>

                              {placesMap.size > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const remaining = subPlacesDraft.filter(
                                      (item) =>
                                        (item.parentPlaceName?.trim() || currentPlaceNameDraft) !==
                                        placeName
                                    );
                                    setSubPlacesDraft(remaining);
                                    if (isActivePlace && remaining[0]) {
                                      setCurrentSubPlaceIdDraft(remaining[0].id);
                                      setCurrentPlaceNameDraft(remaining[0].parentPlaceName);
                                    }
                                  }}
                                  className="rounded-lg p-1 text-slate-500 hover:bg-rose-950/50 hover:text-rose-400 cursor-pointer"
                                  title={`Delete entire "${placeName}" place and its sub-places`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Sub-Places List inside this Place */}
                          <div className="space-y-1.5 pl-2">
                            {subList.map((sp) => {
                              const isCurrentSp =
                                (currentSubPlaceIdDraft || subPlacesDraft[0]?.id) === sp.id;
                              const cachedCount = Object.keys(sp.backgroundsByTime || {}).length;
                              return (
                                <div
                                  key={sp.id}
                                  onClick={() => {
                                    setCurrentSubPlaceIdDraft(sp.id);
                                    setCurrentPlaceNameDraft(sp.parentPlaceName || placeName);
                                  }}
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition cursor-pointer ${
                                    isCurrentSp
                                      ? 'border-emerald-400 bg-emerald-950/40 text-white shadow-sm'
                                      : 'border-slate-800/90 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold truncate">{sp.name}</span>
                                      {isCurrentSp && (
                                        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                                          Active Scene
                                        </span>
                                      )}
                                      {cachedCount > 0 && (
                                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                          {cachedCount} BG{cachedCount === 1 ? '' : 's'} cached
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                      {sp.description || 'No description yet — click to edit on the right'}
                                    </p>
                                  </div>

                                  {subPlacesDraft.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = subPlacesDraft.filter((i) => i.id !== sp.id);
                                        setSubPlacesDraft(next);
                                        if (currentSubPlaceIdDraft === sp.id && next[0]) {
                                          setCurrentSubPlaceIdDraft(next[0].id);
                                          setCurrentPlaceNameDraft(next[0].parentPlaceName);
                                        }
                                      }}
                                      className="ml-2 rounded p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                                      title="Delete this Sub-Place"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Column: Selected Sub-Place Editor & Background Generator Settings */}
              <div className="flex w-1/2 flex-col bg-slate-950">
                <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-white">
                      {selectedSubPlace
                        ? `${selectedSubPlace.parentPlaceName} › ${selectedSubPlace.name}`
                        : 'Sub-Place & Background Studio'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {selectedSubPlace && (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3.5">
                      <div className="text-xs font-bold text-emerald-300">
                        Selected Sub-Place Details (Active in Prompt)
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Main Place (Building / Location)
                          </label>
                          <input
                            type="text"
                            value={selectedSubPlace.parentPlaceName}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSubPlacesDraft((prev) =>
                                prev.map((item) =>
                                  item.id === selectedSubPlace.id
                                    ? { ...item, parentPlaceName: val }
                                    : item
                                )
                              );
                              setCurrentPlaceNameDraft(val);
                            }}
                            placeholder="e.g., The Palace, Home"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-emerald-300 font-semibold"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                            Sub-Place Name (Room / Area)
                          </label>
                          <input
                            type="text"
                            value={selectedSubPlace.name}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSubPlacesDraft((prev) =>
                                prev.map((item) =>
                                  item.id === selectedSubPlace.id
                                    ? { ...item, name: val }
                                    : item
                                )
                              );
                            }}
                            placeholder="e.g., Throne Room, Living Room, Kitchen"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white font-semibold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          Sub-Place Visual & Environmental Description
                        </label>
                        <textarea
                          rows={3}
                          value={selectedSubPlace.description}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSubPlacesDraft((prev) =>
                              prev.map((item) =>
                                item.id === selectedSubPlace.id
                                  ? { ...item, description: val }
                                  : item
                              )
                            );
                          }}
                          placeholder="Describe furniture, lighting, architecture, and props here so characters and the AI background generator know what this sub-place looks like..."
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100 leading-relaxed"
                        />
                      </div>

                      {/* Cached Backgrounds by Time of Day for this Sub-Place */}
                      <div className="pt-1">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-semibold text-slate-300">
                            Cached Backgrounds for &ldquo;{selectedSubPlace.name}&rdquo; (1 per Time of Day)
                          </span>
                          {Object.keys(selectedSubPlace.backgroundsByTime || {}).length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSubPlacesDraft((prev) =>
                                  prev.map((item) =>
                                    item.id === selectedSubPlace.id
                                      ? { ...item, backgroundsByTime: {} }
                                      : item
                                  )
                                );
                              }}
                              className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                            >
                              Clear All Cached BGs
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          {(['dawn', 'morning', 'noon', 'sunset', 'night', 'midnight'] as TimeOfDay[]).map(
                            (timeSlot) => {
                              const bgUrl = selectedSubPlace.backgroundsByTime?.[timeSlot];
                              return (
                                <div
                                  key={timeSlot}
                                  className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px]"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold capitalize text-slate-200">
                                      {timeSlot}
                                    </span>
                                    {bgUrl ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSubPlacesDraft((prev) =>
                                            prev.map((item) => {
                                              if (item.id !== selectedSubPlace.id) return item;
                                              const nextBgs = { ...(item.backgroundsByTime || {}) };
                                              delete nextBgs[timeSlot];
                                              return { ...item, backgroundsByTime: nextBgs };
                                            })
                                          );
                                        }}
                                        className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                                      >
                                        Clear
                                      </button>
                                    ) : (
                                      <span className="text-[10px] text-slate-500">Not cached</span>
                                    )}
                                  </div>
                                  {bgUrl && (
                                    <div
                                      className="mt-1.5 h-12 w-full rounded bg-cover bg-center border border-slate-800"
                                      style={{ backgroundImage: `url("${bgUrl}")` }}
                                    />
                                  )}
                                </div>
                              );
                            }
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Dynamic Chat Background AI Generator Provider Configuration */}
                  <div className="rounded-xl border border-indigo-500/30 bg-slate-900/70 p-4 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
                      <ImageIcon className="h-3.5 w-3.5" />
                      <span>Dynamic Chat Background AI Provider (Generated Once per Place & Time)</span>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Choose Your Image Generation Provider
                      </label>
                      <select
                        value={imageProviderDraft}
                        onChange={(e) =>
                          setImageProviderDraft(e.target.value as ImageGenerationProvider)
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                      >
                        <option value="pollinations">
                          Pollinations / Flux Free AI (Zero API Key Required + Offline SVG Fallback)
                        </option>
                        <option value="nanobanana">
                          NanoBanana / Gemini Image API (OpenAI-Compatible Endpoint)
                        </option>
                        <option value="openai">
                          OpenAI DALL-E / OpenRouter / Custom (/v1/images/generations)
                        </option>
                        <option value="sd_webui">
                          Local Stable Diffusion WebUI / Forge (http://127.0.0.1:7860)
                        </option>
                        <option value="manual_only">
                          Manual Image Upload Only (Disable AI Background Generation)
                        </option>
                      </select>
                    </div>

                    {(imageProviderDraft === 'nanobanana' ||
                      imageProviderDraft === 'openai' ||
                      imageProviderDraft === 'sd_webui') && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">
                            Image API Base URL
                          </label>
                          <input
                            type="text"
                            value={imageBaseUrlDraft}
                            onChange={(e) => setImageBaseUrlDraft(e.target.value)}
                            placeholder={
                              imageProviderDraft === 'sd_webui'
                                ? 'http://127.0.0.1:7860'
                                : 'https://api.openai.com/v1'
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">
                            Image Model ID
                          </label>
                          <input
                            type="text"
                            value={imageModelDraft}
                            onChange={(e) => setImageModelDraft(e.target.value)}
                            placeholder={
                              imageProviderDraft === 'nanobanana'
                                ? 'gemini-2.5-flash-image'
                                : 'dall-e-3'
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-1">
                            Image API Key (Optional if same as LLM)
                          </label>
                          <input
                            type="password"
                            value={imageApiKeyDraft}
                            onChange={(e) => setImageApiKeyDraft(e.target.value)}
                            placeholder="Uses LLM key if blank"
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                          />
                        </div>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoGenerateBackgroundsDraft}
                        onChange={(e) => setAutoGenerateBackgroundsDraft(e.target.checked)}
                      />
                      <span>
                        Auto-generate & cache background once when entering a new (Sub-Place + Time of Day)
                      </span>
                    </label>
                  </div>
                </div>

                <div className="border-t border-slate-800 p-4">
                  <button
                    type="button"
                    onClick={handleSavePlacesAndTime}
                    className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-500 cursor-pointer transition"
                  >
                    Save Places, Sub-Places, Time & Background Settings
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB 7: LOREBOOK (WORLD INFO & KEYWORD TRIGGERS) */}
        {activeTab === 'lorebook' && (
          <div className="flex flex-1 overflow-hidden">
            {/* Middle Column: Lorebooks & Entries List */}
            <div className="flex w-1/2 flex-col border-r border-slate-800 bg-slate-950/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <h3 className="text-sm font-bold text-white">Lorebooks (World Info)</h3>
                <button
                  type="button"
                  onClick={handleCreateLorebook}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/20 border border-indigo-500/40 px-2.5 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Lorebook
                </button>
              </div>

              {/* Lorebook Selector List */}
              <div className="border-b border-slate-800 p-3 space-y-1.5 max-h-48 overflow-y-auto">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1">
                  Check to Attach Lorebook to Current Room
                </div>
                {data.lorebooks.map((lb) => {
                  const isAttached = activeRoomLorebookIds.includes(lb.id);
                  const isSelected = lb.id === selectedLorebookId;
                  return (
                    <div
                      key={lb.id}
                      onClick={() => {
                        setSelectedLorebookId(lb.id);
                        setLorebookTitleDraft(lb.title);
                        setLorebookDescDraft(lb.description || '');
                        if (lb.entries[0]) handleSelectLoreEntry(lb.entries[0]);
                        else setSelectedEntryId(null);
                      }}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition cursor-pointer ${
                        isSelected
                          ? 'border-indigo-500/70 bg-indigo-950/40 text-white'
                          : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isAttached}
                          onChange={() => handleToggleRoomLorebook(lb.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 rounded accent-indigo-500"
                          title="Enable this Lorebook in the active room"
                        />
                        <div className="truncate">
                          <div className="font-bold truncate">{lb.title}</div>
                          <div className="text-[10px] text-slate-400">
                            {lb.entries.length} entries
                          </div>
                        </div>
                      </div>
                      {data.lorebooks.length > 1 && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await fetch('/api/settings', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'delete_lorebook',
                                id: lb.id,
                              }),
                            });
                            await loadSettingsData();
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected Lorebook Name & Description Editor */}
              {selectedLorebookObj && (
                <div className="border-b border-slate-800 bg-slate-900/50 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-300">
                      Lorebook Name
                    </label>
                    <span className="text-[10px] text-slate-500">
                      {activeRoomLorebookIds.includes(selectedLorebookObj.id)
                        ? 'Attached to current room'
                        : 'Not attached to room'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={lorebookTitleDraft}
                      onChange={(e) => setLorebookTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveLorebook();
                        }
                      }}
                      placeholder="Lorebook Name (e.g., Hololive Lore, Cyberpunk 2077)"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveLorebook}
                      disabled={!lorebookTitleDraft.trim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer transition shrink-0"
                    >
                      Save Name
                    </button>
                  </div>
                </div>
              )}

              {/* Entries inside Selected Lorebook */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80">
                <span className="text-xs font-semibold text-slate-300">
                  Entries in {selectedLorebookObj?.title || 'Lorebook'}
                </span>
                {selectedLorebookObj && (
                  <button
                    type="button"
                    onClick={handleCreateLoreEntry}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-600 hover:text-white cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    New Entry
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {selectedLorebookObj?.entries.map((entry) => {
                  const isSelected = entry.id === selectedEntryId;
                  return (
                    <div
                      key={entry.id}
                      onClick={() => handleSelectLoreEntry(entry)}
                      className={`rounded-xl border p-3 transition cursor-pointer ${
                        isSelected
                          ? 'border-indigo-400 bg-indigo-950/35'
                          : 'border-slate-800 bg-slate-900/70 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{entry.title}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            entry.isConstant
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-indigo-500/20 text-indigo-300'
                          }`}
                        >
                          {entry.isConstant ? 'Always Active' : 'Keyword Trigger'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-amber-300/90 font-mono truncate">
                        Keys: {entry.keywords || '(none)'}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{entry.content}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Lorebook Entry Inspector / Editor */}
            <div className="flex w-1/2 flex-col bg-slate-950">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3.5">
                <h3 className="text-sm font-bold text-white">
                  {selectedEntryId ? entryTitleDraft || 'Edit Lore Entry' : 'Lorebook Entry'}
                </h3>
                <div className="flex items-center gap-2">
                  {selectedEntryId && (
                    <button
                      type="button"
                      onClick={async () => {
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'delete_lorebook_entry',
                            id: selectedEntryId,
                          }),
                        });
                        setSelectedEntryId(null);
                        await loadSettingsData();
                      }}
                      className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-950/50 cursor-pointer"
                      title="Delete lore entry"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {selectedEntryId ? (
                <>
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Entry Title
                      </label>
                      <input
                        type="text"
                        value={entryTitleDraft}
                        onChange={(e) => setEntryTitleDraft(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Trigger Keywords (Comma-separated — dynamically injects when mentioned in chat)
                      </label>
                      <input
                        type="text"
                        value={entryKeywordsDraft}
                        onChange={(e) => setEntryKeywordsDraft(e.target.value)}
                        placeholder="e.g., excalibur, whitehall, camellia, sector 7"
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 font-mono text-xs text-amber-200"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-xs text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={entryConstantDraft}
                          onChange={(e) => setEntryConstantDraft(e.target.checked)}
                        />
                        <span>Always Active (Constant)</span>
                      </label>

                      <select
                        value={entryPositionDraft}
                        onChange={(e) =>
                          setEntryPositionDraft(
                            e.target.value as LorebookEntry['insertionPosition']
                          )
                        }
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
                      >
                        <option value="after_scenario">Insert After Scenario</option>
                        <option value="before_char">Insert Before Character Definition</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Lore Content (World Info, Series Context, Faction Rules)
                      </label>
                      <textarea
                        rows={8}
                        maxLength={3000}
                        value={entryContentDraft}
                        onChange={(e) => setEntryContentDraft(e.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3.5 text-xs text-slate-100 leading-relaxed"
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-800 p-4">
                    <button
                      type="button"
                      onClick={handleSaveLoreEntry}
                      className="w-full rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
                    >
                      Save Lorebook Entry
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
                  Select an entry or create a new one
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
