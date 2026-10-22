import { NextResponse } from 'next/server';
import { getLlmSettings } from '@/lib/db';

export interface ProviderModelItem {
  id: string;
  name: string;
  ownedBy?: string;
  contextLength?: number;
  description?: string;
}

const FALLBACK_POPULAR_MODELS: ProviderModelItem[] = [
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    ownedBy: 'openai',
    contextLength: 128000,
    description: 'Fast, responsive, cost-efficient multi-character dialogue model',
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    ownedBy: 'openai',
    contextLength: 128000,
    description: 'High-intelligence flagship model for nuanced character psychology',
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet',
    ownedBy: 'anthropic',
    contextLength: 200000,
    description: 'Story-focused creative roleplay & deep character voice',
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3 / R1',
    ownedBy: 'deepseek',
    contextLength: 64000,
    description: 'Creative, unfiltered roleplay and intricate plotting',
  },
  {
    id: 'llama3.2',
    name: 'Llama 3.2 (Local / Ollama)',
    ownedBy: 'meta',
    contextLength: 32000,
    description: 'Local open-weights model for offline roleplay',
  },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const settings = getLlmSettings();
  const baseUrl = (searchParams.get('baseUrl') || settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = searchParams.get('apiKey') ?? settings.apiKey;

  const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

  if (!apiKey && !isLocal && !baseUrl.includes('openrouter.ai')) {
    return NextResponse.json({
      source: 'fallback',
      models: FALLBACK_POPULAR_MODELS,
      notice: 'Using curated model list (Enter an API key or connect a local server to fetch live provider models).',
    });
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      throw new Error(`Provider returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const rawList: Array<Record<string, unknown>> = Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.models)
      ? data.models
      : [];

    if (rawList.length === 0) {
      return NextResponse.json({
        source: 'fallback',
        models: FALLBACK_POPULAR_MODELS,
      });
    }

    const mapped: ProviderModelItem[] = rawList
      .map((item) => ({
        id: String(item.id || item.name || ''),
        name: String(item.name || item.id || ''),
        ownedBy: item.owned_by ? String(item.owned_by) : undefined,
        contextLength: typeof item.context_length === 'number' ? item.context_length : undefined,
        description: item.description ? String(item.description).slice(0, 140) : undefined,
      }))
      .filter((m) => Boolean(m.id));

    return NextResponse.json({
      source: 'live',
      models: mapped,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      source: 'fallback',
      models: FALLBACK_POPULAR_MODELS,
      notice: `Could not reach ${baseUrl}/models (${
        err instanceof Error ? err.message : 'offline'
      }). Showing standard models.`,
    });
  }
}
