'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquarePlus,
  Settings,
  Send,
  Sparkles,
  Clapperboard,
  Trash2,
  MessagesSquare,
  Database,
  Sliders,
  UserCheck,
  Cpu,
  AtSign,
  RotateCcw,
  Pencil,
  X,
} from 'lucide-react';
import { useRoomOrchestrator } from '@/store/useRoomOrchestrator';
import { MessageBubble } from './MessageBubble';
import { OrchestratorBar } from '../controls/OrchestratorBar';
import { RosterSidebar } from '../controls/RosterSidebar';
import { TavernSettingsModal, type TavernSettingsTab } from '../modals/TavernSettingsModal';
import { CreateRoomModal } from '../modals/CreateRoomModal';
import { CharacterEditorModal } from '../modals/CharacterEditorModal';
import { CharacterDatabaseView } from '../characters/CharacterDatabaseView';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type { RoomWithDetails, MessageWithVersions } from '@/lib/db';
import type {
  Character,
  CharacterOutfit,
  LlmSettings,
  UserPersona,
  SystemPromptPreset,
} from '@/lib/db/schema';

interface RoomApiPayload extends RoomWithDetails {
  messages: MessageWithVersions[];
  suggestedNextCharacterId: string | null;
}

interface UnifiedTavernSettingsResponse {
  settings: LlmSettings;
  systemPrompts: SystemPromptPreset[];
  userPersonas: UserPersona[];
}

export function ChatroomWorkspace() {
  const queryClient = useQueryClient();
  const [activeNav, setActiveNav] = useState<'chatrooms' | 'characters'>('chatrooms');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [userMessageInput, setUserMessageInput] = useState('');
  const [messageMode, setMessageMode] = useState<'user' | 'system'>('user');
  const [autoReplyOnSend, setAutoReplyOnSend] = useState(true);

  const [isTavernSettingsOpen, setIsTavernSettingsOpen] = useState(false);
  const [tavernInitialTab, setTavernInitialTab] = useState<TavernSettingsTab>('model');
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isQuickCharCreateOpen, setIsQuickCharCreateOpen] = useState(false);
  const [roomPendingDeleteId, setRoomPendingDeleteId] = useState<string | null>(null);

  // Quick Responses state (3 AI-suggested user replies, editable & regeneratable)
  const [isQuickResponsesOpen, setIsQuickResponsesOpen] = useState(false);
  const [quickResponses, setQuickResponses] = useState<string[]>([]);
  const [isLoadingQuickResponses, setIsLoadingQuickResponses] = useState(false);

  // @Mention Chain state refs
  const isMentionTurnActiveRef = useRef(false);
  const hasPendingMentionQueueRef = useRef(false);
  const [hasPendingMentionState, setHasPendingMentionState] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);

  const {
    executionState,
    isAutoPlayEnabled,
    activeCharacterId,
    nextCharacterId,
    streamingMessageId,
    streamingContent,
    consecutiveAutoTurns,
    cooldownRemainingMs,
    cooldownTotalMs,
    editingMessageId,
    setExecutionState,
    setAutoPlayEnabled,
    setNextCharacterId,
    setConsecutiveAutoTurns,
    startStreamingSession,
    updateStreamingMeta,
    appendStreamingDelta,
    finishStreamingSession,
    setCooldownProgress,
    setEditingMessageId,
    abortCurrentStream,
    resetOrchestrator,
  } = useRoomOrchestrator();

  // Fetch all rooms
  const { data: roomsData } = useQuery<{ rooms: RoomWithDetails[] }>({
    queryKey: ['rooms'],
    queryFn: async () => {
      const res = await fetch('/api/rooms');
      return res.json();
    },
  });

  // Fetch all characters
  const { data: charactersData } = useQuery<{ characters: Character[] }>({
    queryKey: ['characters'],
    queryFn: async () => {
      const res = await fetch('/api/characters');
      return res.json();
    },
  });

  // Fetch unified Tavern Settings (for active Persona, Model, and System Prompt badges)
  const { data: tavernData } = useQuery<UnifiedTavernSettingsResponse>({
    queryKey: ['tavern_settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      return res.json();
    },
  });

  const roomsList = roomsData?.rooms ?? [];
  const allCharacters = charactersData?.characters ?? [];

  const activeUserPersona =
    tavernData?.settings.personasEnabled
      ? tavernData.userPersonas.find((p) => p.id === tavernData.settings.activePersonaId) ??
        tavernData.userPersonas[0] ??
        null
      : null;

  // Select first room on initial load
  useEffect(() => {
    if (!selectedRoomId && roomsList.length > 0) {
      setSelectedRoomId(roomsList[0].room.id);
    }
  }, [roomsList, selectedRoomId]);

  // Fetch active room details + transcript
  const { data: activeRoomData } = useQuery<RoomApiPayload>({
    queryKey: ['room', selectedRoomId],
    enabled: Boolean(selectedRoomId),
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${selectedRoomId}`);
      if (!res.ok) throw new Error('Failed to load room');
      return res.json();
    },
  });

  // Sync nextCharacterId when room loads
  useEffect(() => {
    if (activeRoomData && executionState === 'IDLE') {
      setNextCharacterId(
        activeRoomData.suggestedNextCharacterId ??
          activeRoomData.queueState.nextCharacterId ??
          activeRoomData.roster.find((r) => r.isActive)?.characterId ??
          null
      );
    }
  }, [activeRoomData, executionState, setNextCharacterId]);

  // Scroll to bottom when new messages arrive or during live streaming
  useEffect(() => {
    if (!editingMessageId && activeNav === 'chatrooms') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeRoomData?.messages.length, streamingMessageId, editingMessageId, activeNav]);

  // Core SSE Stream Dispatcher
  const dispatchCharacterStream = useCallback(
    async (options?: {
      characterId?: string;
      regenerateMessageId?: string;
      truncateSubsequent?: boolean;
      isManualTrigger?: boolean;
      directAddressTo?: string;
    }) => {
      if (!selectedRoomId) return;

      const controller = new AbortController();
      startStreamingSession({
        characterId: options?.characterId ?? nextCharacterId,
        messageId: options?.regenerateMessageId ?? null,
        abortController: controller,
      });

      try {
        const response = await fetch(`/api/rooms/${selectedRoomId}/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            characterId: options?.characterId,
            regenerateMessageId: options?.regenerateMessageId,
            truncateSubsequent: options?.truncateSubsequent,
            isManualTrigger: options?.isManualTrigger,
            directAddressTo: options?.directAddressTo,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let eventName = 'message';
            let dataLine = '';
            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLine = line.slice(5).trim();
              }
            }
            if (!dataLine) continue;

            const payload = JSON.parse(dataLine);

            if (eventName === 'meta') {
              updateStreamingMeta({
                messageId: payload.messageId,
                characterId: payload.characterId,
              });
              queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
            } else if (eventName === 'delta') {
              appendStreamingDelta(payload.delta);
            } else if (eventName === 'done') {
              const autoTurns = Number(payload.consecutiveAutoTurns ?? 0);
              const maxAllowed = activeRoomData?.room.maxAutoTurns ?? 8;
              const hasPendingMention = Boolean(payload.hasPendingMentionTurn);

              hasPendingMentionQueueRef.current = hasPendingMention;
              setHasPendingMentionState(hasPendingMention);

              let shouldContinueCooldown = false;
              if (hasPendingMention && autoTurns < maxAllowed) {
                // Either another user-@mentioned character is queued OR the AI character just @mentioned another character
                isMentionTurnActiveRef.current = true;
                shouldContinueCooldown = true;
              } else if (isMentionTurnActiveRef.current) {
                // Mention chain finished — stop here so ONLY the mentioned character(s) speak
                isMentionTurnActiveRef.current = false;
                shouldContinueCooldown = false;
              } else {
                shouldContinueCooldown =
                  useRoomOrchestrator.getState().isAutoPlayEnabled && autoTurns < maxAllowed;
              }

              if (autoTurns >= maxAllowed && useRoomOrchestrator.getState().isAutoPlayEnabled) {
                setAutoPlayEnabled(false);
              }

              finishStreamingSession({
                nextState: shouldContinueCooldown ? 'COOLDOWN' : 'IDLE',
                nextCharacterId: payload.nextCharacterId ?? null,
                consecutiveAutoTurns: autoTurns,
              });

              await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
            } else if (eventName === 'aborted' || eventName === 'error') {
              finishStreamingSession({
                nextState: 'PAUSED',
                nextCharacterId: nextCharacterId,
                consecutiveAutoTurns: useRoomOrchestrator.getState().consecutiveAutoTurns,
              });
              await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
          return;
        }
        finishStreamingSession({
          nextState: 'PAUSED',
          nextCharacterId,
          consecutiveAutoTurns: useRoomOrchestrator.getState().consecutiveAutoTurns,
        });
        await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
      }
    },
    [
      selectedRoomId,
      nextCharacterId,
      activeRoomData?.room.maxAutoTurns,
      startStreamingSession,
      updateStreamingMeta,
      appendStreamingDelta,
      finishStreamingSession,
      setAutoPlayEnabled,
      queryClient,
    ]
  );

  // Cooldown Countdown Loop -> Auto-Dispatch Next Character Turn (or Next @Mentioned Character)
  useEffect(() => {
    const shouldRunCooldown =
      executionState === 'COOLDOWN' &&
      Boolean(selectedRoomId) &&
      (isAutoPlayEnabled || hasPendingMentionState || hasPendingMentionQueueRef.current);

    if (!shouldRunCooldown) {
      return;
    }

    const totalMs = hasPendingMentionQueueRef.current
      ? Math.min(activeRoomData?.room.cooldownMs ?? 3000, 1500)
      : activeRoomData?.room.cooldownMs ?? 3000;
    const startTime = performance.now();
    setCooldownProgress(totalMs, totalMs);

    let rafId: number;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      setCooldownProgress(remaining, totalMs);

      if (remaining <= 0) {
        setExecutionState('QUEUED');
        dispatchCharacterStream({
          characterId: useRoomOrchestrator.getState().nextCharacterId ?? undefined,
          isManualTrigger: false,
        });
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    executionState,
    isAutoPlayEnabled,
    hasPendingMentionState,
    selectedRoomId,
    activeRoomData?.room.cooldownMs,
    setCooldownProgress,
    setExecutionState,
    dispatchCharacterStream,
  ]);

  const openTavernSettings = (tab: TavernSettingsTab = 'model') => {
    setTavernInitialTab(tab);
    setIsTavernSettingsOpen(true);
  };

  // Handlers
  const handleCreateCharacterApi = async (
    input: Omit<Character, 'id' | 'createdAt'>
  ): Promise<Character> => {
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    await queryClient.invalidateQueries({ queryKey: ['characters'] });
    return data.character;
  };

  const handleUpdateCharacterApi = async (
    id: string,
    patch: Partial<Omit<Character, 'id' | 'createdAt'>>
  ): Promise<void> => {
    await fetch(`/api/characters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await queryClient.invalidateQueries({ queryKey: ['characters'] });
    await queryClient.invalidateQueries({ queryKey: ['rooms'] });
    if (selectedRoomId) {
      await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
    }
  };

  const handleDeleteCharacterApi = async (id: string): Promise<void> => {
    await fetch(`/api/characters/${id}`, {
      method: 'DELETE',
    });
    await queryClient.invalidateQueries({ queryKey: ['characters'] });
    await queryClient.invalidateQueries({ queryKey: ['rooms'] });
    if (selectedRoomId) {
      await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
    }
  };

  const effectiveUserDisplayName =
    activeUserPersona?.name || activeRoomData?.room.userDisplayName || 'Director';

  const sendUserMessageText = async (rawText: string) => {
    const text = rawText.trim();
    if (!selectedRoomId || !text) return;

    if (executionState === 'STREAMING') {
      abortCurrentStream(selectedRoomId);
    }

    setUserMessageInput('');

    const res = await fetch(`/api/rooms/${selectedRoomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        senderType: messageMode,
        senderName: effectiveUserDisplayName,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const mentionedIds: string[] = Array.isArray(data.mentionedCharacterIds)
        ? data.mentionedCharacterIds
        : [];

      setConsecutiveAutoTurns(0);
      if (data.nextCharacterId) {
        setNextCharacterId(data.nextCharacterId);
      }
      await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });

      if (mentionedIds.length > 0) {
        // Explicit @mention: trigger ONLY the mentioned character(s)
        isMentionTurnActiveRef.current = true;
        hasPendingMentionQueueRef.current = mentionedIds.length > 1;
        setHasPendingMentionState(mentionedIds.length > 1);
        dispatchCharacterStream({
          characterId: mentionedIds[0],
          isManualTrigger: true,
        });
      } else if (
        (autoReplyOnSend || isAutoPlayEnabled) &&
        activeRoomData?.room.turnStrategy !== 'manual_only'
      ) {
        isMentionTurnActiveRef.current = false;
        hasPendingMentionQueueRef.current = false;
        setHasPendingMentionState(false);
        dispatchCharacterStream({
          characterId: data.nextCharacterId,
          isManualTrigger: !isAutoPlayEnabled,
        });
      }
    }
  };

  const handleSendUserMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendUserMessageText(userMessageInput);
  };

  const handleGenerateQuickResponses = async () => {
    if (!selectedRoomId) return;
    setIsQuickResponsesOpen(true);
    setIsLoadingQuickResponses(true);
    try {
      const res = await fetch(`/api/rooms/${selectedRoomId}/quick-responses`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setQuickResponses(Array.isArray(data.responses) ? data.responses.slice(0, 3) : []);
      }
    } finally {
      setIsLoadingQuickResponses(false);
    }
  };

  const handleInsertMention = (characterName: string) => {
    const tag = `@${characterName} `;
    // If the user is currently typing an @query at the end of the input, replace it
    const match = userMessageInput.match(/(?:^|\s)@([^\s@]*)$/);
    if (match && match.index !== undefined) {
      const prefix = userMessageInput.slice(0, match.index + (match[0].startsWith(' ') ? 1 : 0));
      setUserMessageInput(`${prefix}${tag}`);
    } else {
      const needsSpace =
        userMessageInput.length > 0 && !userMessageInput.endsWith(' ');
      setUserMessageInput(`${userMessageInput}${needsSpace ? ' ' : ''}${tag}`);
    }
    composerInputRef.current?.focus();
  };

  const handleToggleAutoPlay = () => {
    if (isAutoPlayEnabled) {
      setAutoPlayEnabled(false);
      if (executionState === 'COOLDOWN') {
        setExecutionState('PAUSED');
        setCooldownProgress(0, cooldownTotalMs);
      }
    } else {
      const maxTurns = activeRoomData?.room.maxAutoTurns ?? 8;
      if (consecutiveAutoTurns >= maxTurns) {
        setConsecutiveAutoTurns(0);
      }
      setAutoPlayEnabled(true);
      if (executionState === 'IDLE' || executionState === 'PAUSED') {
        dispatchCharacterStream({ isManualTrigger: false });
      }
    }
  };

  const handleTriggerSpecificCharacter = (characterId: string, directAddressTo?: string) => {
    if (!selectedRoomId) return;
    if (executionState === 'STREAMING') {
      abortCurrentStream(selectedRoomId);
    }
    setNextCharacterId(characterId);
    dispatchCharacterStream({
      characterId,
      isManualTrigger: true,
      directAddressTo,
    });
  };

  const handleRegenerateMessage = (messageId: string, truncateSubsequent: boolean) => {
    if (!selectedRoomId) return;
    if (executionState === 'STREAMING') {
      abortCurrentStream(selectedRoomId);
    }
    dispatchCharacterStream({
      regenerateMessageId: messageId,
      truncateSubsequent,
      isManualTrigger: true,
    });
  };

  const handleSaveInlineEdit = async (messageId: string, newContent: string) => {
    if (!selectedRoomId) return;
    await fetch(`/api/rooms/${selectedRoomId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent }),
    });
    setEditingMessageId(null);
    await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
  };

  const handleSwitchMessageVersion = async (messageId: string, targetVersionIndex: number) => {
    if (!selectedRoomId) return;
    await fetch(`/api/rooms/${selectedRoomId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetVersionIndex }),
    });
    await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedRoomId) return;
    await fetch(`/api/rooms/${selectedRoomId}/messages/${messageId}`, {
      method: 'DELETE',
    });
    await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });
  };

  const handleCreateNewRoom = async (input: {
    title: string;
    scenarioPrompt: string;
    rosterCharacterIds: string[];
  }) => {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        scenarioPrompt: input.scenarioPrompt,
        userDisplayName: effectiveUserDisplayName,
        roster: input.rosterCharacterIds.map((characterId) => ({ characterId })),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ['rooms'] });
      resetOrchestrator();
      setSelectedRoomId(data.roomDetails.room.id);
      setActiveNav('chatrooms');
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    if (executionState === 'STREAMING' && selectedRoomId === roomId) {
      abortCurrentStream(roomId);
    }
    await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
    queryClient.removeQueries({ queryKey: ['room', roomId] });
    await queryClient.invalidateQueries({ queryKey: ['rooms'] });
    if (selectedRoomId === roomId) {
      resetOrchestrator();
      const remaining = roomsList.find((r) => r.room.id !== roomId);
      setSelectedRoomId(remaining?.room.id ?? null);
    }
    setRoomPendingDeleteId(null);
  };

  const roomPendingDelete = roomPendingDeleteId
    ? roomsList.find((r) => r.room.id === roomPendingDeleteId)?.room ?? null
    : null;

  const characterMap = new Map<string, Character>();
  allCharacters.forEach((c) => {
    let outfits: CharacterOutfit[] = [];
    try {
      outfits = JSON.parse(c.outfitsJson || '[]');
    } catch {
      outfits = [];
    }
    const defaultOutfit = outfits.find((o) => o.id === c.activeOutfitId);
    characterMap.set(c.id, {
      ...c,
      avatarUrl: defaultOutfit?.avatarUrl || c.avatarUrl,
    });
  });
  activeRoomData?.roster.forEach((r) => {
    let outfits: CharacterOutfit[] = [];
    try {
      outfits = JSON.parse(r.character.outfitsJson || '[]');
    } catch {
      outfits = [];
    }
    const targetOutfitId =
      r.activeOutfitId !== null && r.activeOutfitId !== undefined
        ? r.activeOutfitId
        : r.character.activeOutfitId;
    const roomOutfit = outfits.find((o) => o.id === targetOutfitId);
    characterMap.set(r.characterId, {
      ...r.character,
      avatarUrl: roomOutfit?.avatarUrl || r.character.avatarUrl,
    });
  });

  const activeCharacter = activeCharacterId ? characterMap.get(activeCharacterId) ?? null : null;
  const nextCharacter = nextCharacterId ? characterMap.get(nextCharacterId) ?? null : null;
  const messages = activeRoomData?.messages ?? [];

  const activeRosterMembers = activeRoomData?.roster.filter((r) => r.isActive) ?? [];
  const knownCharacterNames = Array.from(characterMap.values()).map((c) => c.name);

  // Detect trailing @mention query in userMessageInput for live autocomplete
  const mentionQueryMatch = userMessageInput.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionQueryMatch ? mentionQueryMatch[1].toLowerCase() : null;
  const matchingMentionCharacters =
    mentionQuery !== null
      ? activeRosterMembers.filter(
          (m) =>
            m.character.name.toLowerCase().includes(mentionQuery) ||
            m.character.roleTitle.toLowerCase().includes(mentionQuery)
        )
      : [];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Left Navigation Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/90">
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow">
              <MessagesSquare className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">MultiChat Studio</h1>
              <p className="text-[10px] text-slate-400">Multi-Agent Tavern Engine</p>
            </div>
          </div>
        </div>

        {/* Primary Menu Switcher: Chatrooms vs Character Database */}
        <div className="border-b border-slate-800 p-2.5 space-y-1">
          <button
            type="button"
            onClick={() => setActiveNav('chatrooms')}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
              activeNav === 'chatrooms'
                ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
            }`}
          >
            <span className="flex items-center gap-2">
              <MessagesSquare className="h-4 w-4" />
              Chatrooms Studio
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
              {roomsList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (executionState === 'STREAMING' && selectedRoomId) {
                abortCurrentStream(selectedRoomId);
              }
              setActiveNav('characters');
            }}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition cursor-pointer ${
              activeNav === 'characters'
                ? 'bg-indigo-600/20 text-indigo-200 border border-indigo-500/40'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent'
            }`}
          >
            <span className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Character Database
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
              {allCharacters.length}
            </span>
          </button>
        </div>

        {/* New Room Action */}
        <div className="p-3 pb-2">
          <button
            type="button"
            onClick={() => setIsCreateRoomOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
          >
            <MessageSquarePlus className="h-4 w-4" />
            New Multi-AI Chatroom
          </button>
        </div>

        {/* Rooms List */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1.5">
          <div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Active Story Rooms
          </div>
          {roomsList.map(({ room, roster }) => {
            const isSelected = room.id === selectedRoomId && activeNav === 'chatrooms';
            return (
              <div
                key={room.id}
                onClick={() => {
                  if (room.id !== selectedRoomId) {
                    resetOrchestrator();
                    setSelectedRoomId(room.id);
                  }
                  setActiveNav('chatrooms');
                }}
                className={`group flex items-center justify-between rounded-xl border p-2.5 transition cursor-pointer ${
                  isSelected
                    ? 'border-indigo-500/60 bg-indigo-950/40 text-white'
                    : 'border-transparent bg-slate-900/40 text-slate-300 hover:border-slate-800 hover:bg-slate-800/60'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{room.title}</div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {roster.slice(0, 5).map((m) => (
                        <CharacterAvatar
                          key={m.characterId}
                          name={m.character.name}
                          avatarColor={m.character.avatarColor}
                          avatarUrl={m.character.avatarUrl}
                          size="xs"
                          className="ring-1 ring-slate-900"
                        />
                      ))}
                    </div>
                    <span className="ml-1.5 text-[10px] text-slate-400">
                      {roster.length} cast
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRoomPendingDeleteId(room.id);
                  }}
                  className={`rounded-lg p-1.5 transition cursor-pointer ${
                    isSelected
                      ? 'text-slate-400 hover:bg-rose-950/60 hover:text-rose-300'
                      : 'opacity-0 group-hover:opacity-100 text-slate-500 hover:bg-rose-950/50 hover:text-rose-400'
                  }`}
                  title="Delete chatroom"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {roomsList.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
              No active rooms yet. Click &ldquo;New Multi-AI Chatroom&rdquo; above to create one.
            </div>
          )}
        </div>

        {/* Bottom Unified Tavern Chat & Engine Settings Button */}
        <div className="border-t border-slate-800 p-3">
          <button
            type="button"
            onClick={() => openTavernSettings('model')}
            className="flex w-full items-center justify-between rounded-xl border border-indigo-500/40 bg-indigo-950/30 px-3 py-2.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-900/40 hover:text-white cursor-pointer transition"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-indigo-400" />
              Tavern Chat Settings
            </span>
            <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
              7 Tabs
            </span>
          </button>
        </div>
      </aside>

      {/* Main Content Area: Either Dedicated Character Database OR Chatroom Studio */}
      {activeNav === 'characters' ? (
        <CharacterDatabaseView
          characters={allCharacters}
          rooms={roomsList}
          onCreateCharacter={handleCreateCharacterApi}
          onUpdateCharacter={handleUpdateCharacterApi}
          onDeleteCharacter={handleDeleteCharacterApi}
          onOpenRoom={(roomId) => {
            resetOrchestrator();
            setSelectedRoomId(roomId);
            setActiveNav('chatrooms');
          }}
        />
      ) : activeRoomData ? (
        <>
          <main className="flex flex-1 flex-col min-w-0">
            {/* Room Header with Quick Tavern Pills */}
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-900/60 px-6 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-white">
                  {activeRoomData.room.title}
                </h2>
                <p className="truncate text-xs text-slate-400">
                  {activeRoomData.room.scenarioPrompt || 'No scenario description set'}
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => openTavernSettings('model')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-indigo-500/50 hover:text-white cursor-pointer"
                  title="Active Model & Sampler Tuning"
                >
                  <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="font-mono text-[11px]">
                    {tavernData?.settings.defaultModel.split('/').pop() || 'gpt-4o-mini'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => openTavernSettings('persona')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-slate-300 hover:border-indigo-500/50 hover:text-white cursor-pointer"
                  title="Active User Persona ({{user}})"
                >
                  <UserCheck className="h-3.5 w-3.5 text-blue-400" />
                  <span>{effectiveUserDisplayName}</span>
                </button>

                <button
                  type="button"
                  onClick={() => openTavernSettings('scenario')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-600/20 px-3 py-1 font-semibold text-indigo-200 hover:bg-indigo-600/30 cursor-pointer"
                >
                  <Sliders className="h-3.5 w-3.5" />
                  Chat Settings
                </button>

                <button
                  type="button"
                  onClick={() => setRoomPendingDeleteId(activeRoomData.room.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/30 px-2.5 py-1 font-semibold text-rose-300 hover:bg-rose-600 hover:text-white cursor-pointer transition"
                  title="Delete this chatroom"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Room
                </button>
              </div>
            </header>

            {/* Real-Time Turn & Stream Orchestrator Bar */}
            <OrchestratorBar
              executionState={executionState}
              isAutoPlayEnabled={isAutoPlayEnabled}
              activeCharacter={activeCharacter}
              nextCharacter={nextCharacter}
              consecutiveAutoTurns={consecutiveAutoTurns}
              maxAutoTurns={activeRoomData.room.maxAutoTurns}
              cooldownRemainingMs={cooldownRemainingMs}
              cooldownTotalMs={cooldownTotalMs}
              onToggleAutoPlay={handleToggleAutoPlay}
              onStepNextTurn={() => dispatchCharacterStream({ isManualTrigger: true })}
              onSkipCooldown={() => {
                setCooldownProgress(0, cooldownTotalMs);
                setExecutionState('QUEUED');
                dispatchCharacterStream({ isManualTrigger: false });
              }}
              onStopAndAbort={() => abortCurrentStream(activeRoomData.room.id)}
              onResetTurnCounter={() => setConsecutiveAutoTurns(0)}
            />

            {/* Transcript Viewport */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                  <Sparkles className="h-10 w-10 text-indigo-400/60 mb-2" />
                  <p className="text-sm font-medium text-slate-300">
                    This multi-character room is ready.
                  </p>
                  <p className="max-w-md text-xs text-slate-500 mt-1">
                    Send a message below, click &ldquo;Start Auto-Chat&rdquo; in the top bar, or trigger any character directly from the right-hand roster.
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isStreamingThis =
                    executionState === 'STREAMING' && streamingMessageId === msg.id;
                  return (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      character={msg.characterId ? characterMap.get(msg.characterId) : undefined}
                      knownCharacterNames={knownCharacterNames}
                      userAvatarUrl={activeUserPersona?.avatarUrl}
                      isLatestMessage={idx === messages.length - 1}
                      isStreamingThisMessage={isStreamingThis}
                      liveStreamContent={isStreamingThis ? streamingContent : ''}
                      isEditing={editingMessageId === msg.id}
                      disabledActions={executionState === 'STREAMING'}
                      onStartEdit={(id) => setEditingMessageId(id)}
                      onCancelEdit={() => setEditingMessageId(null)}
                      onSaveEdit={handleSaveInlineEdit}
                      onRegenerate={handleRegenerateMessage}
                      onSwitchVersion={handleSwitchMessageVersion}
                      onDelete={handleDeleteMessage}
                    />
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Bottom Human Intervention Composer */}
            <form
              onSubmit={handleSendUserMessage}
              className="relative border-t border-slate-800 bg-slate-900/90 p-4"
            >
              {/* Quick Responses Drawer (3 AI-Generated User Replies, Editable & Regeneratable) */}
              {isQuickResponsesOpen && (
                <div className="mb-3 rounded-xl border border-indigo-500/40 bg-slate-950/95 p-3 shadow-lg">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-200">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                      <span>
                        Quick Responses for <strong>{effectiveUserDisplayName}</strong>
                      </span>
                      <span className="text-[11px] font-normal text-slate-400">
                        (Click any option to edit in box before sending)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isLoadingQuickResponses}
                        onClick={handleGenerateQuickResponses}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-600/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-600/35 disabled:opacity-40 cursor-pointer transition"
                        title="Regenerate 3 new response suggestions"
                      >
                        <RotateCcw
                          className={`h-3 w-3 ${isLoadingQuickResponses ? 'animate-spin' : ''}`}
                        />
                        {isLoadingQuickResponses ? 'Generating...' : 'Regenerate (3x)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsQuickResponsesOpen(false)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                        title="Close Quick Responses"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {isLoadingQuickResponses ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="h-16 animate-pulse rounded-lg border border-slate-800 bg-slate-900/70 p-2.5"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {quickResponses.map((reply, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setMessageMode('user');
                            setUserMessageInput(reply);
                            composerInputRef.current?.focus();
                          }}
                          className="group flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-left text-xs text-slate-200 hover:border-indigo-500/60 hover:bg-indigo-950/30 cursor-pointer transition"
                        >
                          <p className="line-clamp-3 leading-relaxed">{reply}</p>
                          <div className="mt-2 flex items-center justify-between border-t border-slate-800/80 pt-1.5 text-[10px]">
                            <span className="inline-flex items-center gap-1 text-indigo-300 group-hover:text-indigo-200 font-medium">
                              <Pencil className="h-2.5 w-2.5" />
                              Click to Edit
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMessageMode('user');
                                setIsQuickResponsesOpen(false);
                                sendUserMessageText(reply);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-indigo-600/80 px-2 py-0.5 font-semibold text-white hover:bg-indigo-500 cursor-pointer"
                              title="Send this response immediately"
                            >
                              <Send className="h-2.5 w-2.5" />
                              Send
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Live @Mention Autocomplete Popup when typing '@' */}
              {matchingMentionCharacters.length > 0 && (
                <div className="mb-2 rounded-xl border border-indigo-500/50 bg-slate-950 p-2 shadow-xl">
                  <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                    Mention Character (Triggers ONLY mentioned character to speak)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {matchingMentionCharacters.map((m) => (
                      <button
                        key={m.characterId}
                        type="button"
                        onClick={() => handleInsertMention(m.character.name)}
                        className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 hover:border-indigo-500 hover:bg-indigo-950/50 cursor-pointer transition"
                      >
                        <CharacterAvatar
                          name={m.character.name}
                          avatarColor={m.character.avatarColor}
                          avatarUrl={m.character.avatarUrl}
                          size="xs"
                        />
                        <span className="font-semibold">@{m.character.name}</span>
                        <span className="text-[10px] text-slate-400">({m.character.roleTitle})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMessageMode('user')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                      messageMode === 'user'
                        ? 'bg-blue-600/25 text-blue-200 border border-blue-500/50'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Speak as {effectiveUserDisplayName}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMessageMode('system')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                      messageMode === 'system'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/50'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Clapperboard className="h-3.5 w-3.5" />
                    Stage Direction / World Event
                  </button>

                  {/* Quick Responses Generator Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!isQuickResponsesOpen || quickResponses.length === 0) {
                        handleGenerateQuickResponses();
                      } else {
                        setIsQuickResponsesOpen((v) => !v);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold transition cursor-pointer ${
                      isQuickResponsesOpen
                        ? 'border-indigo-400 bg-indigo-600/30 text-indigo-100'
                        : 'border-indigo-500/40 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 hover:text-white'
                    }`}
                    title="Generate 3 possible user responses that you can edit or regenerate"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                    Quick Responses
                  </button>

                  {/* Quick @Char Mention Pills */}
                  {activeRosterMembers.length > 0 && (
                    <div className="flex items-center gap-1 pl-1 border-l border-slate-800">
                      <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400 mr-0.5">
                        <AtSign className="h-3 w-3 text-indigo-400" />
                        Mention:
                      </span>
                      {activeRosterMembers.map((m) => (
                        <button
                          key={m.characterId}
                          type="button"
                          onClick={() => handleInsertMention(m.character.name)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] font-medium text-indigo-300 hover:border-indigo-500/60 hover:bg-indigo-950/50 hover:text-white cursor-pointer transition"
                          title={`Mention @${m.character.name} so ONLY ${m.character.name} responds`}
                        >
                          @{m.character.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReplyOnSend}
                    onChange={(e) => setAutoReplyOnSend(e.target.checked)}
                    className="rounded border-slate-700 text-indigo-600"
                  />
                  <span>Trigger next AI character after sending</span>
                </label>
              </div>

              <div className="flex gap-2">
                <input
                  ref={composerInputRef}
                  type="text"
                  value={userMessageInput}
                  onChange={(e) => setUserMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.key === 'Tab' || e.key === 'Enter') &&
                      matchingMentionCharacters.length > 0 &&
                      mentionQuery !== null
                    ) {
                      e.preventDefault();
                      handleInsertMention(matchingMentionCharacters[0].character.name);
                    }
                  }}
                  placeholder={
                    messageMode === 'system'
                      ? 'Enter a shared stage event (e.g., "The lights suddenly flicker out and a shot rings in the street below.")...'
                      : `Intervene as ${effectiveUserDisplayName}... (Type @char to mention a specific character, or *asterisks* for actions)`
                  }
                  className="flex-1 rounded-xl border border-slate-700/90 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!userMessageInput.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 cursor-pointer transition"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </form>
          </main>

          {/* Right Column: Character Roster & Manual Turn Triggers */}
          <RosterSidebar
            room={activeRoomData.room}
            roster={activeRoomData.roster}
            allCharacters={allCharacters}
            activeCharacterId={activeCharacterId}
            nextCharacterId={nextCharacterId}
            isStreaming={executionState === 'STREAMING'}
            activeUserDisplayName={effectiveUserDisplayName}
            onTriggerCharacter={handleTriggerSpecificCharacter}
            onUpdateRoomSettings={async (patch) => {
              await fetch(`/api/rooms/${activeRoomData.room.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              });
              await queryClient.invalidateQueries({ queryKey: ['room', activeRoomData.room.id] });
              await queryClient.invalidateQueries({ queryKey: ['rooms'] });
            }}
            onCreateCharacter={handleCreateCharacterApi}
            onUpdateCharacter={handleUpdateCharacterApi}
            onOpenTavernSettings={(tab) => openTavernSettings(tab)}
          />
        </>
      ) : roomsList.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mb-4">
            <MessagesSquare className="h-7 w-7" />
          </div>
          <h2 className="text-base font-bold text-white">No Chatrooms Open</h2>
          <p className="mt-1 max-w-md text-xs text-slate-400">
            Create a new multi-character chatroom and assign characters from your database to start a scene.
          </p>
          <button
            type="button"
            onClick={() => setIsCreateRoomOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow hover:bg-indigo-500 cursor-pointer transition"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Create Multi-AI Chatroom
          </button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Loading chatroom...
        </div>
      )}

      {/* Delete Chatroom Confirmation Modal */}
      {roomPendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Chatroom?</h3>
                <p className="text-xs text-slate-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="mt-4 text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-white">&ldquo;{roomPendingDelete.title}&rdquo;</strong> and all of its conversation history? Your characters in the Character Database will remain safe.
            </p>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRoomPendingDeleteId(null)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRoom(roomPendingDelete.id)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-rose-500 cursor-pointer transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Chatroom
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unified Moescape-Style 3-Pane Tavern Settings Modal */}
      <TavernSettingsModal
        isOpen={isTavernSettingsOpen}
        initialTab={tavernInitialTab}
        activeRoom={activeRoomData?.room ?? null}
        onClose={() => setIsTavernSettingsOpen(false)}
        onRequestDeleteRoom={(roomId) => setRoomPendingDeleteId(roomId)}
        onUpdateRoom={async (patch) => {
          if (!activeRoomData?.room.id) return;
          await fetch(`/api/rooms/${activeRoomData.room.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          await queryClient.invalidateQueries({ queryKey: ['room', activeRoomData.room.id] });
          await queryClient.invalidateQueries({ queryKey: ['rooms'] });
        }}
        onSettingsChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['tavern_settings'] });
          if (activeRoomData?.room.id) {
            queryClient.invalidateQueries({ queryKey: ['room', activeRoomData.room.id] });
          }
        }}
      />

      {/* Scalable Create Multi-Character Room Modal */}
      <CreateRoomModal
        isOpen={isCreateRoomOpen}
        allCharacters={allCharacters}
        onClose={() => setIsCreateRoomOpen(false)}
        onCreateRoom={handleCreateNewRoom}
        onOpenNewCharacterModal={() => setIsQuickCharCreateOpen(true)}
      />

      {/* Quick Create Character Modal */}
      <CharacterEditorModal
        isOpen={isQuickCharCreateOpen}
        initialCharacter={null}
        onClose={() => setIsQuickCharCreateOpen(false)}
        onSave={async (data) => {
          await handleCreateCharacterApi(data);
        }}
      />
    </div>
  );
}
