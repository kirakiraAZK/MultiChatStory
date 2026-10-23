import { NextResponse } from 'next/server';
import { getLlmSettings } from '@/lib/db';

export interface ProviderModelItem {
  id: string;
  name: string;
  ownedBy?: string;
  contextLength?: number;
  description?: string;
}

const ANTHROPIC_MODELS: ProviderModelItem[] = [
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    ownedBy: 'anthropic',
    contextLength: 200000,
    description: 'Industry-leading intelligence for creative roleplay, novelistic prose & deep subtext',
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    ownedBy: 'anthropic',
    contextLength: 200000,
    description: 'Ultra-fast, snappy dialogue with sharp conversational tone',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    ownedBy: 'anthropic',
    contextLength: 200000,
    description: 'Complex worldbuilding, intricate plots, and rich character psychology',
  },
];

const GEMINI_MODELS: ProviderModelItem[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    ownedBy: 'google',
    contextLength: 1048576,
    description: 'Next-gen multimodal speed, high context, and natural multi-turn conversations',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    ownedBy: 'google',
    contextLength: 2097152,
    description: '2M context window for massive multi-character roleplay archives and lorebooks',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    ownedBy: 'google',
    contextLength: 1048576,
    description: 'Lightweight, ultra-fast dialogue engine with huge 1M context',
  },
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const settings = getLlmSettings();
  const rawBaseUrl = searchParams.get('baseUrl') || settings.baseUrl || 'https://api.openai.com/v1';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '');
  const apiKey = (searchParams.get('apiKey') ?? settings.apiKey ?? '').trim();
  const provider = (searchParams.get('provider') || '').toLowerCase();

  const isLocal = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');
  const isAnthropic = provider === 'anthropic' || baseUrl.includes('anthropic.com');
  const isGemini = provider === 'gemini' || baseUrl.includes('generativelanguage.googleapis.com');
  const isOpenRouter = provider === 'openrouter' || baseUrl.includes('openrouter.ai');

  // If no API key is provided and not a local server (and not OpenRouter free list),
  // DO NOT show fake models — return empty models with clear notice that Local Simulated Fallback is active!
  if (!apiKey && !isLocal && !isOpenRouter) {
    return NextResponse.json({
      source: 'no_key',
      models: [],
      notice:
        'No API key entered. MultiChat Studio is currently using the Local Simulated Roleplay Engine (Offline / Free). Enter an API key and click "Fetch Models" to load remote models.',
    });
  }

  // Anthropic / Claude Provider
  if (isAnthropic) {
    if (apiKey) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data) && json.data.length > 0) {
            const liveAnthropic: ProviderModelItem[] = json.data.map(
              (m: { id: string; display_name?: string }) => ({
                id: m.id,
                name: m.display_name || m.id,
                ownedBy: 'anthropic',
                contextLength: 200000,
                description: 'Anthropic Claude model',
              })
            );
            return NextResponse.json({ source: 'live', models: liveAnthropic });
          }
        }
      } catch {
        // Fall back to curated Anthropic list
      }
    }
    return NextResponse.json({
      source: apiKey ? 'curated' : 'no_key',
      models: apiKey ? ANTHROPIC_MODELS : [],
      notice: apiKey ? undefined : 'Enter an Anthropic API key to use Claude models.',
    });
  }

  // Google Gemini Provider
  if (isGemini) {
    if (apiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.models) && json.models.length > 0) {
            const mappedGemini: ProviderModelItem[] = json.models
              .filter(
                (m: { name?: string; supportedGenerationMethods?: string[] }) =>
                  m.name &&
                  (m.supportedGenerationMethods?.includes('generateContent') ||
                    m.name.includes('gemini'))
              )
              .map((m: { name: string; displayName?: string; description?: string }) => {
                const cleanId = m.name.replace(/^models\//, '');
                return {
                  id: cleanId,
                  name: m.displayName || cleanId,
                  ownedBy: 'google',
                  contextLength: cleanId.includes('1.5-pro') ? 2000000 : 1000000,
                  description: m.description || 'Google Gemini Model',
                };
              });
            if (mappedGemini.length > 0) {
              return NextResponse.json({ source: 'live', models: mappedGemini });
            }
          }
        }
      } catch {
        // Fall back to curated Gemini list
      }
    }
    return NextResponse.json({
      source: apiKey ? 'curated' : 'no_key',
      models: apiKey ? GEMINI_MODELS : [],
      notice: apiKey ? undefined : 'Enter a Google Gemini API key to use Gemini models.',
    });
  }

  // OpenAI / OpenRouter / Ollama / LM Studio / Custom OpenAI-Compatible
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    // Determine models URL
    let modelsUrl = `${baseUrl}/models`;
    if (baseUrl.includes('localhost:11434') && !baseUrl.endsWith('/v1')) {
      modelsUrl = `${baseUrl}/v1/models`;
    }

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
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
        source: 'empty',
        models: [],
        notice: 'Connected to provider, but no models were returned by the server.',
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
      source: 'error',
      models: [],
      notice: `Could not reach ${baseUrl}/models (${
        err instanceof Error ? err.message : 'offline'
      }). Check that the server is running or verify your API key and URL.`,
    });
  }
}
