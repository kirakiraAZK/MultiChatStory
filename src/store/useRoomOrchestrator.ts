import { create } from 'zustand';

export type ExecutionState = 'IDLE' | 'QUEUED' | 'STREAMING' | 'COOLDOWN' | 'PAUSED';

interface RoomOrchestratorStore {
  executionState: ExecutionState;
  isAutoPlayEnabled: boolean;
  activeCharacterId: string | null;
  nextCharacterId: string | null;
  streamingMessageId: string | null;
  streamingContent: string;
  consecutiveAutoTurns: number;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
  editingMessageId: string | null;
  abortController: AbortController | null;

  setExecutionState: (state: ExecutionState) => void;
  setAutoPlayEnabled: (enabled: boolean) => void;
  setNextCharacterId: (id: string | null) => void;
  setConsecutiveAutoTurns: (count: number) => void;
  startStreamingSession: (params: {
    characterId: string | null;
    messageId?: string | null;
    abortController: AbortController;
  }) => void;
  updateStreamingMeta: (params: { messageId: string; characterId: string }) => void;
  appendStreamingDelta: (delta: string) => void;
  finishStreamingSession: (params: {
    nextState: ExecutionState;
    nextCharacterId: string | null;
    consecutiveAutoTurns: number;
  }) => void;
  setCooldownProgress: (remainingMs: number, totalMs: number) => void;
  setEditingMessageId: (messageId: string | null) => void;
  abortCurrentStream: (roomId?: string) => void;
  resetOrchestrator: () => void;
}

export const useRoomOrchestrator = create<RoomOrchestratorStore>((set, get) => ({
  executionState: 'IDLE',
  isAutoPlayEnabled: false,
  activeCharacterId: null,
  nextCharacterId: null,
  streamingMessageId: null,
  streamingContent: '',
  consecutiveAutoTurns: 0,
  cooldownRemainingMs: 0,
  cooldownTotalMs: 3000,
  editingMessageId: null,
  abortController: null,

  setExecutionState: (executionState) => set({ executionState }),
  setAutoPlayEnabled: (isAutoPlayEnabled) => set({ isAutoPlayEnabled }),
  setNextCharacterId: (nextCharacterId) => set({ nextCharacterId }),
  setConsecutiveAutoTurns: (consecutiveAutoTurns) => set({ consecutiveAutoTurns }),

  startStreamingSession: ({ characterId, messageId = null, abortController }) => {
    const prev = get().abortController;
    if (prev && !prev.signal.aborted) {
      prev.abort();
    }
    set({
      executionState: 'STREAMING',
      activeCharacterId: characterId,
      streamingMessageId: messageId,
      streamingContent: '',
      cooldownRemainingMs: 0,
      abortController,
    });
  },

  updateStreamingMeta: ({ messageId, characterId }) =>
    set({
      streamingMessageId: messageId,
      activeCharacterId: characterId,
    }),

  appendStreamingDelta: (delta) =>
    set((state) => ({
      streamingContent: state.streamingContent + delta,
    })),

  finishStreamingSession: ({ nextState, nextCharacterId, consecutiveAutoTurns }) =>
    set({
      executionState: nextState,
      activeCharacterId: null,
      streamingMessageId: null,
      streamingContent: '',
      nextCharacterId,
      consecutiveAutoTurns,
      abortController: null,
    }),

  setCooldownProgress: (cooldownRemainingMs, cooldownTotalMs) =>
    set({ cooldownRemainingMs, cooldownTotalMs }),

  setEditingMessageId: (editingMessageId) => {
    if (editingMessageId !== null) {
      const { abortController, executionState } = get();
      if (abortController && !abortController.signal.aborted) {
        abortController.abort();
      }
      set({
        editingMessageId,
        isAutoPlayEnabled: false,
        cooldownRemainingMs: 0,
        executionState: executionState === 'IDLE' ? 'IDLE' : 'PAUSED',
      });
    } else {
      set({ editingMessageId: null });
    }
  },

  abortCurrentStream: (roomId) => {
    const { abortController } = get();
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    if (roomId) {
      fetch(`/api/rooms/${roomId}/stream`, { method: 'DELETE' }).catch(() => {});
    }
    set({
      executionState: 'PAUSED',
      isAutoPlayEnabled: false,
      activeCharacterId: null,
      streamingMessageId: null,
      streamingContent: '',
      cooldownRemainingMs: 0,
      abortController: null,
    });
  },

  resetOrchestrator: () => {
    const { abortController } = get();
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    set({
      executionState: 'IDLE',
      isAutoPlayEnabled: false,
      activeCharacterId: null,
      streamingMessageId: null,
      streamingContent: '',
      consecutiveAutoTurns: 0,
      cooldownRemainingMs: 0,
      editingMessageId: null,
      abortController: null,
    });
  },
}));
