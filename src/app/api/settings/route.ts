import { NextResponse } from 'next/server';
import {
  getLlmSettings,
  updateLlmSettings,
  listSystemPrompts,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  listSamplerPresets,
  createSamplerPreset,
  deleteSamplerPreset,
  listUserPersonas,
  createUserPersona,
  updateUserPersona,
  deleteUserPersona,
  listLorebooksWithEntries,
  createLorebook,
  updateLorebook,
  deleteLorebook,
  createLorebookEntry,
  updateLorebookEntry,
  deleteLorebookEntry,
} from '@/lib/db';

export async function GET() {
  return NextResponse.json({
    settings: getLlmSettings(),
    systemPrompts: listSystemPrompts(),
    samplerPresets: listSamplerPresets(),
    userPersonas: listUserPersonas(),
    lorebooks: listLorebooksWithEntries(),
  });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const updated = updateLlmSettings({
    baseUrl: body.baseUrl !== undefined ? String(body.baseUrl).trim() : undefined,
    apiKey: body.apiKey !== undefined ? String(body.apiKey).trim() : undefined,
    defaultModel: body.defaultModel !== undefined ? String(body.defaultModel).trim() : undefined,
    useMockFallback: body.useMockFallback !== undefined ? Boolean(body.useMockFallback) : undefined,
    temperature: body.temperature !== undefined ? Number(body.temperature) : undefined,
    maxTokens: body.maxTokens !== undefined ? Number(body.maxTokens) : undefined,
    topP: body.topP !== undefined ? Number(body.topP) : undefined,
    topK: body.topK !== undefined ? Number(body.topK) : undefined,
    minP: body.minP !== undefined ? Number(body.minP) : undefined,
    repetitionPenalty: body.repetitionPenalty !== undefined ? Number(body.repetitionPenalty) : undefined,
    frequencyPenalty: body.frequencyPenalty !== undefined ? Number(body.frequencyPenalty) : undefined,
    presencePenalty: body.presencePenalty !== undefined ? Number(body.presencePenalty) : undefined,
    activeSystemPromptId: body.activeSystemPromptId !== undefined ? String(body.activeSystemPromptId) : undefined,
    personasEnabled: body.personasEnabled !== undefined ? Boolean(body.personasEnabled) : undefined,
    activePersonaId: body.activePersonaId !== undefined ? String(body.activePersonaId) : undefined,
    activePresetId: body.activePresetId !== undefined ? (body.activePresetId ? String(body.activePresetId) : null) : undefined,
    favoriteModelsJson: body.favoriteModelsJson !== undefined ? String(body.favoriteModelsJson) : undefined,
  });

  return NextResponse.json({
    settings: updated,
    systemPrompts: listSystemPrompts(),
    samplerPresets: listSamplerPresets(),
    userPersonas: listUserPersonas(),
    lorebooks: listLorebooksWithEntries(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action || '');

    switch (action) {
      // System Prompts
      case 'create_system_prompt': {
        createSystemPrompt({
          title: String(body.title || 'Custom Prompt').trim(),
          content: String(body.content || ''),
        });
        break;
      }
      case 'update_system_prompt': {
        updateSystemPrompt(String(body.id), {
          title: body.title !== undefined ? String(body.title).trim() : undefined,
          content: body.content !== undefined ? String(body.content) : undefined,
        });
        break;
      }
      case 'delete_system_prompt': {
        deleteSystemPrompt(String(body.id));
        break;
      }

      // Sampler Presets
      case 'create_sampler_preset': {
        const created = createSamplerPreset({
          title: String(body.title || 'Custom Preset').trim(),
          description: String(body.description || ''),
          temperature: Number(body.temperature ?? 0.75),
          maxTokens: Number(body.maxTokens ?? 300),
          topP: Number(body.topP ?? 0.92),
          topK: Number(body.topK ?? 100),
          minP: Number(body.minP ?? 0.05),
          repetitionPenalty: Number(body.repetitionPenalty ?? 1.05),
          frequencyPenalty: Number(body.frequencyPenalty ?? 0),
          presencePenalty: Number(body.presencePenalty ?? 0),
          systemPromptId: body.systemPromptId ? String(body.systemPromptId) : null,
        });
        updateLlmSettings({ activePresetId: created.id });
        break;
      }
      case 'delete_sampler_preset': {
        deleteSamplerPreset(String(body.id));
        break;
      }

      // User Personas
      case 'create_persona': {
        const created = createUserPersona({
          title: String(body.title || 'New Persona').trim(),
          name: String(body.name || 'User').trim(),
          description: String(body.description || ''),
          avatarUrl: body.avatarUrl ? String(body.avatarUrl) : null,
        });
        updateLlmSettings({ activePersonaId: created.id, personasEnabled: true });
        break;
      }
      case 'update_persona': {
        updateUserPersona(String(body.id), {
          title: body.title !== undefined ? String(body.title).trim() : undefined,
          name: body.name !== undefined ? String(body.name).trim() : undefined,
          description: body.description !== undefined ? String(body.description) : undefined,
          avatarUrl: body.avatarUrl !== undefined ? (body.avatarUrl ? String(body.avatarUrl) : null) : undefined,
        });
        break;
      }
      case 'delete_persona': {
        deleteUserPersona(String(body.id));
        break;
      }

      // Lorebooks & Entries
      case 'create_lorebook': {
        createLorebook({
          title: String(body.title || 'New Lorebook').trim(),
          description: String(body.description || ''),
        });
        break;
      }
      case 'update_lorebook': {
        updateLorebook(String(body.id), {
          title: body.title !== undefined ? String(body.title).trim() : undefined,
          description: body.description !== undefined ? String(body.description) : undefined,
        });
        break;
      }
      case 'delete_lorebook': {
        deleteLorebook(String(body.id));
        break;
      }
      case 'create_lorebook_entry': {
        createLorebookEntry({
          lorebookId: String(body.lorebookId),
          title: String(body.title || 'New Lore Entry').trim(),
          keywords: String(body.keywords || ''),
          content: String(body.content || ''),
          isConstant: Boolean(body.isConstant),
          isEnabled: body.isEnabled === undefined ? true : Boolean(body.isEnabled),
          insertionPosition: body.insertionPosition === 'before_char' ? 'before_char' : 'after_scenario',
        });
        break;
      }
      case 'update_lorebook_entry': {
        updateLorebookEntry(String(body.id), {
          title: body.title !== undefined ? String(body.title).trim() : undefined,
          keywords: body.keywords !== undefined ? String(body.keywords) : undefined,
          content: body.content !== undefined ? String(body.content) : undefined,
          isConstant: body.isConstant !== undefined ? Boolean(body.isConstant) : undefined,
          isEnabled: body.isEnabled !== undefined ? Boolean(body.isEnabled) : undefined,
          insertionPosition: body.insertionPosition,
        });
        break;
      }
      case 'delete_lorebook_entry': {
        deleteLorebookEntry(String(body.id));
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({
      settings: getLlmSettings(),
      systemPrompts: listSystemPrompts(),
      samplerPresets: listSamplerPresets(),
      userPersonas: listUserPersonas(),
      lorebooks: listLorebooksWithEntries(),
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Operation failed' },
      { status: 400 }
    );
  }
}
