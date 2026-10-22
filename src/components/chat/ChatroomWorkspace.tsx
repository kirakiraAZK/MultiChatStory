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
} from 'lucide-react';
import { useRoomOrchestrator } from '@/store/useRoomOrchestrator';
import { MessageBubble } from './MessageBubble';
import { OrchestratorBar } from '../controls/OrchestratorBar';
import { RosterSidebar } from '../controls/RosterSidebar';
import { LlmSettingsModal } from '../modals/LlmSettingsModal';
import { CreateRoomModal } from '../modals/CreateRoomModal';
import { CharacterEditorModal } from '../modals/CharacterEditorModal';
import { CharacterDatabaseView } from '../characters/CharacterDatabaseView';
import { CharacterAvatar } from '../common/CharacterAvatar';
import type { RoomWithDetails, MessageWithVersions } from '@/lib/db';
import type { Character } from '@/lib/db/schema';

interface RoomApiPayload extends RoomWithDetails {
  messages: MessageWithVersions[];
  suggestedNextCharacterId: string | null;
}

export function ChatroomWorkspace() {
  const queryClient = useQueryClient();
  const [activeNav, setActiveNav] = useState<'chatrooms' | 'characters'>('chatrooms');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [userMessageInput, setUserMessageInput] = useState('');
  const [messageMode, setMessageMode] = useState<'user' | 'system'>('user');
  const [autoReplyOnSend, setAutoReplyOnSend] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
  const [isQuickCharCreateOpen, setIsQuickCharCreateOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const roomsList = roomsData?.rooms ?? [];
  const allCharacters = charactersData?.characters ?? [];

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
              const shouldContinueCooldown =
                useRoomOrchestrator.getState().isAutoPlayEnabled && autoTurns < maxAllowed;

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

  // Cooldown Countdown Loop -> Auto-Dispatch Next Character Turn
  useEffect(() => {
    if (executionState !== 'COOLDOWN' || !isAutoPlayEnabled || !selectedRoomId) {
      return;
    }

    const totalMs = activeRoomData?.room.cooldownMs ?? 3000;
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
        dispatchCharacterStream({ isManualTrigger: false });
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
    selectedRoomId,
    activeRoomData?.room.cooldownMs,
    setCooldownProgress,
    setExecutionState,
    dispatchCharacterStream,
  ]);

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

  const handleSendUserMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoomId || !userMessageInput.trim()) return;

    if (executionState === 'STREAMING') {
      abortCurrentStream(selectedRoomId);
    }

    const text = userMessageInput.trim();
    setUserMessageInput('');

    const res = await fetch(`/api/rooms/${selectedRoomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        senderType: messageMode,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setConsecutiveAutoTurns(0);
      if (data.nextCharacterId) {
        setNextCharacterId(data.nextCharacterId);
      }
      await queryClient.invalidateQueries({ queryKey: ['room', selectedRoomId] });

      if (
        (autoReplyOnSend || isAutoPlayEnabled) &&
        activeRoomData?.room.turnStrategy !== 'manual_only'
      ) {
        dispatchCharacterStream({
          characterId: data.nextCharacterId,
          isManualTrigger: !isAutoPlayEnabled,
        });
      }
    }
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

  const handleTriggerSpecificCharacter = (characterId: string) => {
    if (!selectedRoomId) return;
    if (executionState === 'STREAMING') {
      abortCurrentStream(selectedRoomId);
    }
    setNextCharacterId(characterId);
    dispatchCharacterStream({
      characterId,
      isManualTrigger: true,
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
    if (roomsList.length <= 1) return;
    await fetch(`/api/rooms/${roomId}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: ['rooms'] });
    if (selectedRoomId === roomId) {
      const remaining = roomsList.find((r) => r.room.id !== roomId);
      setSelectedRoomId(remaining?.room.id ?? null);
    }
  };

  const characterMap = new Map<string, Character>();
  allCharacters.forEach((c) => characterMap.set(c.id, c));
  activeRoomData?.roster.forEach((r) => characterMap.set(r.characterId, r.character));

  const activeCharacter = activeCharacterId ? characterMap.get(activeCharacterId) ?? null : null;
  const nextCharacter = nextCharacterId ? characterMap.get(nextCharacterId) ?? null : null;
  const messages = activeRoomData?.messages ?? [];

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
              <p className="text-[10px] text-slate-400">Multi-Agent Story Engine</p>
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
                {roomsList.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRoom(room.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 rounded p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                    title="Delete room"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom LLM Provider Settings Button */}
        <div className="border-t border-slate-800 p-3">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white cursor-pointer transition"
          >
            <span className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-indigo-400" />
              AI Provider & API Key
            </span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
              Ready
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
            {/* Room Header */}
            <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/60 px-6 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-white">
                  {activeRoomData.room.title}
                </h2>
                <p className="truncate text-xs text-slate-400">
                  {activeRoomData.room.scenarioPrompt || 'No scenario description set'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
                <span className="rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1">
                  Strategy:{' '}
                  <strong className="text-slate-200">
                    {activeRoomData.room.turnStrategy === 'round_robin'
                      ? 'Round-Robin'
                      : activeRoomData.room.turnStrategy === 'dynamic_router'
                      ? 'Dynamic Router'
                      : 'Manual Only'}
                  </strong>
                </span>
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
              className="border-t border-slate-800 bg-slate-900/90 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMessageMode('user')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                      messageMode === 'user'
                        ? 'bg-blue-600/25 text-blue-200 border border-blue-500/50'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Speak as {activeRoomData.room.userDisplayName}
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
                  type="text"
                  value={userMessageInput}
                  onChange={(e) => setUserMessageInput(e.target.value)}
                  placeholder={
                    messageMode === 'system'
                      ? 'Enter a shared stage event (e.g., "The lights suddenly flicker out and a shot rings in the street below.")...'
                      : `Intervene as ${activeRoomData.room.userDisplayName}... (Use *asterisks* for physical actions)`
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
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
          Loading chatroom...
        </div>
      )}

      {/* LLM Settings Modal */}
      <LlmSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Scalable Create Multi-Character Room Modal */}
      <CreateRoomModal
        isOpen={isCreateRoomOpen}
        allCharacters={allCharacters}
        onClose={() => setIsCreateRoomOpen(false)}
        onCreateRoom={handleCreateNewRoom}
        onOpenNewCharacterModal={() => setIsQuickCharCreateOpen(true)}
      />

      {/* Quick Create Character Modal (Opened from inside Create Room Modal) */}
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
