import { NextResponse } from 'next/server';
import { getLlmSettings, updateLlmSettings } from '@/lib/db';

export async function GET() {
  const settings = getLlmSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const updated = updateLlmSettings({
    baseUrl: body.baseUrl !== undefined ? String(body.baseUrl).trim() : undefined,
    apiKey: body.apiKey !== undefined ? String(body.apiKey).trim() : undefined,
    defaultModel: body.defaultModel !== undefined ? String(body.defaultModel).trim() : undefined,
    useMockFallback: body.useMockFallback !== undefined ? Boolean(body.useMockFallback) : undefined,
  });
  return NextResponse.json({ settings: updated });
}
