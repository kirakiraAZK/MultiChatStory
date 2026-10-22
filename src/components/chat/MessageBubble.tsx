'use client';

import React, { useState, useEffect } from 'react';
import {
  RotateCcw,
  Rewind,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Check,
  X,
  Sparkles,
  User,
  AlertCircle,
} from 'lucide-react';
import type { MessageWithVersions } from '@/lib/db';
import type { Character } from '@/lib/db/schema';
import { CharacterAvatar } from '../common/CharacterAvatar';

interface MessageBubbleProps {
  message: MessageWithVersions;
  character?: Character;
  userAvatarUrl?: string | null;
  isLatestMessage: boolean;
  isStreamingThisMessage: boolean;
  liveStreamContent: string;
  isEditing: boolean;
  disabledActions: boolean;
  onStartEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (messageId: string, newContent: string) => Promise<void>;
  onRegenerate: (messageId: string, truncateSubsequent: boolean) => void;
  onSwitchVersion: (messageId: string, versionIndex: number) => void;
  onDelete: (messageId: string) => void;
}

function renderFormattedDialogue(text: string) {
  if (!text) return null;
  // Split by *action* blocks so physical stage actions are styled distinctly from spoken dialogue
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <span key={idx} className="italic text-amber-300/90 font-normal">
          {part}{' '}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function MessageBubble({
  message,
  character,
  userAvatarUrl,
  isLatestMessage,
  isStreamingThisMessage,
  liveStreamContent,
  isEditing,
  disabledActions,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onSwitchVersion,
  onDelete,
}: MessageBubbleProps) {
  const [draftText, setDraftText] = useState(message.content);
  const [isSaving, setIsSaving] = useState(false);
  const [showPromptInspector, setShowPromptInspector] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDraftText(message.content);
    }
  }, [isEditing, message.content]);

  const displayedContent = isStreamingThisMessage ? liveStreamContent : message.content;
  const isCharacter = message.senderType === 'character';
  const isUser = message.senderType === 'user';
  const isSystem = message.senderType === 'system';
  const accentColor = character?.avatarColor || (isUser ? '#3b82f6' : '#64748b');

  const handleSave = async () => {
    if (!draftText.trim()) return;
    setIsSaving(true);
    try {
      await onSaveEdit(message.id, draftText.trim());
    } finally {
      setIsSaving(false);
    }
  };

  if (isSystem) {
    return (
      <div className="my-3 flex items-center justify-center">
        <div className="max-w-2xl rounded-full border border-slate-700/80 bg-slate-900/90 px-4 py-1.5 text-xs text-slate-300 italic shadow-sm">
          <span className="font-semibold not-italic text-amber-400 mr-1.5">[Stage Direction]</span>
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative rounded-xl border transition-all duration-150 p-4 ${
        isStreamingThisMessage
          ? 'border-indigo-500/60 bg-slate-900/95 shadow-lg shadow-indigo-950/30'
          : isUser
          ? 'border-blue-900/40 bg-slate-900/60 hover:border-slate-700'
          : 'border-slate-800/90 bg-slate-900/85 hover:border-slate-700/90'
      }`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5">
          {/* Avatar */}
          {isUser ? (
            userAvatarUrl ? (
              <CharacterAvatar
                name={message.senderNameSnapshot}
                avatarColor={accentColor}
                avatarUrl={userAvatarUrl}
                size="md"
              />
            ) : (
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
                style={{ backgroundColor: accentColor }}
              >
                <User className="h-4 w-4" />
              </div>
            )
          ) : (
            <CharacterAvatar
              name={message.senderNameSnapshot}
              avatarColor={accentColor}
              avatarUrl={character?.avatarUrl}
              size="md"
            />
          )}

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-100">
                {message.senderNameSnapshot}
              </span>
              {character?.roleTitle && (
                <span className="text-xs text-slate-400 hidden sm:inline">
                  • {character.roleTitle}
                </span>
              )}
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                #{message.sequenceNumber}
              </span>

              {message.isEdited && (
                <span
                  title={
                    message.originalContent
                      ? `Original before edit:\n${message.originalContent}`
                      : 'Edited by human'
                  }
                  className="rounded bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                >
                  Edited
                </span>
              )}

              {message.status === 'aborted' && !isStreamingThisMessage && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                  <AlertCircle className="h-2.5 w-2.5" />
                  Interrupted
                </span>
              )}

              {isStreamingThisMessage && (
                <span className="inline-flex items-center gap-1 rounded bg-indigo-500/20 border border-indigo-400/40 px-2 py-0.5 text-[10px] font-medium text-indigo-300 animate-pulse">
                  <Sparkles className="h-2.5 w-2.5" />
                  Streaming...
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Toolbar: Version Switcher, Regenerate, Rewind & Regenerate, Edit, Prompt Inspector, Delete */}
        <div className="flex items-center gap-1">
          {/* Version History Switcher (< 1 / 2 >) */}
          {message.versionCount > 1 && !isStreamingThisMessage && (
            <div className="mr-1 flex items-center rounded-md border border-slate-700/80 bg-slate-800/90 px-1 py-0.5 text-[11px] text-slate-300">
              <button
                type="button"
                disabled={disabledActions || message.activeVersionIndex <= 1}
                onClick={() => onSwitchVersion(message.id, message.activeVersionIndex - 1)}
                className="p-0.5 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Previous generated version"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 font-mono text-[10px]">
                v{message.activeVersionIndex}/{message.versionCount}
              </span>
              <button
                type="button"
                disabled={disabledActions || message.activeVersionIndex >= message.versionCount}
                onClick={() => onSwitchVersion(message.id, message.activeVersionIndex + 1)}
                className="p-0.5 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Next generated version"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Regenerate Controls (Only for AI Character messages) */}
          {isCharacter && !isStreamingThisMessage && !isEditing && (
            <>
              <button
                type="button"
                disabled={disabledActions}
                onClick={() => onRegenerate(message.id, false)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-xs text-slate-200 hover:border-indigo-500/60 hover:bg-indigo-950/60 hover:text-indigo-200 disabled:opacity-40 cursor-pointer transition"
                title="Regenerate this character's response in-place (keeps history as a new version)"
              >
                <RotateCcw className="h-3 w-3" />
                <span className="hidden md:inline">Regenerate</span>
              </button>

              {!isLatestMessage && (
                <button
                  type="button"
                  disabled={disabledActions}
                  onClick={() => onRegenerate(message.id, true)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-xs text-amber-300/90 hover:border-amber-500/60 hover:bg-amber-950/50 disabled:opacity-40 cursor-pointer transition"
                  title="Rewind & Regenerate from here (deletes messages after this turn and regenerates)"
                >
                  <Rewind className="h-3 w-3" />
                  <span className="hidden lg:inline">Rewind Here</span>
                </button>
              )}
            </>
          )}

          {/* Inline Edit Button */}
          {!isStreamingThisMessage && !isEditing && (
            <button
              type="button"
              onClick={() => onStartEdit(message.id)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700/70 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white cursor-pointer transition"
              title="Inline Edit message (subsequent AI turns will immediately use your edited text)"
            >
              <Pencil className="h-3 w-3" />
              <span className="hidden sm:inline">Edit</span>
            </button>
          )}

          {/* Inspect Assembled Multi-Character Prompt */}
          {message.promptDebugJson && !isEditing && (
            <button
              type="button"
              onClick={() => setShowPromptInspector((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-pointer transition ${
                showPromptInspector
                  ? 'border-indigo-500 bg-indigo-950/70 text-indigo-200'
                  : 'border-slate-700/70 bg-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
              title="Inspect exact target-perspective OpenAI prompt payload sent for this turn"
            >
              <Code2 className="h-3 w-3" />
            </button>
          )}

          {/* Delete Message */}
          {!isStreamingThisMessage && !isEditing && (
            <button
              type="button"
              disabled={disabledActions}
              onClick={() => onDelete(message.id)}
              className="rounded-md border border-transparent p-1 text-slate-500 hover:border-rose-800/60 hover:bg-rose-950/40 hover:text-rose-300 disabled:opacity-40 cursor-pointer transition"
              title="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Message Body OR Inline Editor */}
      {isEditing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancelEdit();
              }
            }}
            rows={4}
            autoFocus
            className="w-full rounded-lg border border-indigo-500/70 bg-slate-950 p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            placeholder="Edit message content..."
          />
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>
              Tip: Use <code className="text-amber-300">*asterisks*</code> for physical actions. Press{' '}
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5">Ctrl+Enter</kbd> to save.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving || !draftText.trim()}
                onClick={handleSave}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                {isSaving ? 'Saving...' : 'Save & Update Context'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="pl-10 text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">
          {displayedContent ? (
            renderFormattedDialogue(displayedContent)
          ) : isStreamingThisMessage ? (
            <span className="italic text-slate-500">Assembling response...</span>
          ) : null}
          {isStreamingThisMessage && (
            <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-indigo-400 align-middle" />
          )}
        </div>
      )}

      {/* Expandable Prompt Payload Inspector */}
      {showPromptInspector && message.promptDebugJson && (
        <div className="mt-3 ml-10 rounded-lg border border-slate-700/80 bg-slate-950 p-3 text-xs">
          <div className="mb-1.5 flex items-center justify-between text-slate-400">
            <span className="font-semibold text-indigo-300">
              Assembled Target-Perspective OpenAI Payload (Sent for {message.senderNameSnapshot})
            </span>
            <button
              type="button"
              onClick={() => setShowPromptInspector(false)}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>
          <pre className="max-h-64 overflow-auto font-mono text-[11px] text-slate-300">
            {message.promptDebugJson}
          </pre>
        </div>
      )}
    </div>
  );
}
