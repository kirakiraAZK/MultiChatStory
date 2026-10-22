'use client';

import React from 'react';
import {
  Play,
  Pause,
  Square,
  StepForward,
  FastForward,
  RotateCcw,
  Sparkles,
  Timer,
} from 'lucide-react';
import type { ExecutionState } from '@/store/useRoomOrchestrator';
import type { Character } from '@/lib/db/schema';

interface OrchestratorBarProps {
  executionState: ExecutionState;
  isAutoPlayEnabled: boolean;
  activeCharacter: Character | null;
  nextCharacter: Character | null;
  consecutiveAutoTurns: number;
  maxAutoTurns: number;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
  onToggleAutoPlay: () => void;
  onStepNextTurn: () => void;
  onSkipCooldown: () => void;
  onStopAndAbort: () => void;
  onResetTurnCounter: () => void;
}

export function OrchestratorBar({
  executionState,
  isAutoPlayEnabled,
  activeCharacter,
  nextCharacter,
  consecutiveAutoTurns,
  maxAutoTurns,
  cooldownRemainingMs,
  cooldownTotalMs,
  onToggleAutoPlay,
  onStepNextTurn,
  onSkipCooldown,
  onStopAndAbort,
  onResetTurnCounter,
}: OrchestratorBarProps) {
  const isStreaming = executionState === 'STREAMING';
  const isCooldown = executionState === 'COOLDOWN' && cooldownRemainingMs > 0;
  const cooldownProgressPct =
    cooldownTotalMs > 0
      ? Math.min(100, Math.max(0, ((cooldownTotalMs - cooldownRemainingMs) / cooldownTotalMs) * 100))
      : 0;

  const stateBadgeConfig: Record<
    ExecutionState,
    { label: string; classes: string }
  > = {
    IDLE: {
      label: 'IDLE • READY',
      classes: 'bg-slate-800 text-slate-300 border-slate-700',
    },
    QUEUED: {
      label: 'QUEUED • DISPATCHING',
      classes: 'bg-indigo-950 text-indigo-300 border-indigo-700',
    },
    STREAMING: {
      label: `STREAMING • ${activeCharacter?.name ?? 'AI'}`,
      classes: 'bg-indigo-600/25 text-indigo-200 border-indigo-500 animate-pulse',
    },
    COOLDOWN: {
      label: `COOLDOWN • ${(cooldownRemainingMs / 1000).toFixed(1)}s`,
      classes: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
    },
    PAUSED: {
      label: 'PAUSED BY USER',
      classes: 'bg-rose-950/80 text-rose-300 border-rose-700/60',
    },
  };

  const currentBadge = stateBadgeConfig[executionState];

  return (
    <div className="border-b border-slate-800 bg-slate-900/95 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: State Machine Status & Next Speaker */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide ${currentBadge.classes}`}
          >
            {isStreaming && <Sparkles className="h-3 w-3" />}
            {isCooldown && <Timer className="h-3 w-3" />}
            {currentBadge.label}
          </span>

          {!isStreaming && nextCharacter && (
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Next up:</span>
              <span
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/80 bg-slate-800/90 px-2 py-0.5 font-medium text-slate-200"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: nextCharacter.avatarColor }}
                />
                {nextCharacter.name}
              </span>
            </div>
          )}

          {/* Auto-Turn Loop Threshold Counter */}
          <div className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs text-slate-400">
            <span>Auto-Loop:</span>
            <span
              className={`font-mono font-semibold ${
                consecutiveAutoTurns >= maxAutoTurns ? 'text-amber-400' : 'text-slate-200'
              }`}
            >
              {consecutiveAutoTurns} / {maxAutoTurns}
            </span>
            {consecutiveAutoTurns > 0 && (
              <button
                type="button"
                onClick={onResetTurnCounter}
                title="Reset auto-turn counter to 0"
                className="ml-1 text-slate-500 hover:text-slate-200 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Execution Controls (Auto-Chat Play/Pause, Step 1 Turn, Skip Cooldown, Stop/Abort) */}
        <div className="flex items-center gap-2">
          {/* Auto-Chat Toggle Button */}
          <button
            type="button"
            onClick={onToggleAutoPlay}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
              isAutoPlayEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm shadow-emerald-950'
                : 'border border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-600 hover:bg-slate-700'
            }`}
          >
            {isAutoPlayEnabled ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause Auto-Chat
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Start Auto-Chat
              </>
            )}
          </button>

          {/* Step Single Turn (When not currently streaming) */}
          {!isStreaming && (
            <button
              type="button"
              onClick={isCooldown ? onSkipCooldown : onStepNextTurn}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-600/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/30 cursor-pointer transition"
              title={
                isCooldown
                  ? 'Skip cooldown countdown and trigger next character immediately'
                  : `Trigger ${nextCharacter?.name ?? 'next character'} for 1 turn`
              }
            >
              {isCooldown ? (
                <>
                  <FastForward className="h-3.5 w-3.5" />
                  Skip Cooldown
                </>
              ) : (
                <>
                  <StepForward className="h-3.5 w-3.5" />
                  Next Turn
                </>
              )}
            </button>
          )}

          {/* Hard Stop / Abort Active Stream Button */}
          {(isStreaming || isCooldown || isAutoPlayEnabled) && (
            <button
              type="button"
              onClick={onStopAndAbort}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-600/60 bg-rose-600/20 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-600/35 cursor-pointer transition"
              title="Immediately abort active stream (via AbortController) and stop auto-chat"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Cooldown Visual Progress Bar */}
      {isCooldown && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-amber-400 transition-all duration-75"
            style={{ width: `${cooldownProgressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
