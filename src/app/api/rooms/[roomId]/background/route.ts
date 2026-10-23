import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  getLlmSettings,
  getRoomWithDetails,
  parseRoomSubPlaces,
  resolveRoomLocationAndTime,
  updateRoom,
} from '@/lib/db';
import type { TimeOfDay } from '@/lib/db/schema';

const TIME_LIGHTING_PROMPTS: Record<TimeOfDay, string> = {
  dawn: 'early dawn twilight, soft rose-gold sunrise glow on the horizon, gentle morning mist, cinematic atmospheric lighting',
  morning: 'bright clear morning sunlight, warm golden sunbeams streaming through, crisp fresh daytime atmosphere, detailed environment',
  noon: 'high midday sun, bright natural daylight, vibrant colors, clear crisp shadows, detailed architectural and natural lighting',
  sunset: 'dramatic golden hour sunset, warm amber and violet sky, long cinematic shadows, glowing twilight atmosphere',
  night: 'atmospheric night scene, moonlight and warm glowing indoor lamps or streetlamps, deep blue-indigo night shadows, cinematic nocturne',
  midnight: 'deep midnight atmosphere, low moody chiaroscuro lighting, flickering candlelight or dim amber streetlamp glow, mysterious shadows',
};

const TIME_PALETTES: Record<
  TimeOfDay,
  { skyTop: string; skyBottom: string; glow: string; accent: string; silhouette: string }
> = {
  dawn: {
    skyTop: '#1e1b4b',
    skyBottom: '#f472b6',
    glow: '#fbbf24',
    accent: '#fda4af',
    silhouette: '#0f172a',
  },
  morning: {
    skyTop: '#0284c7',
    skyBottom: '#bae6fd',
    glow: '#fef08a',
    accent: '#38bdf8',
    silhouette: '#0f172a',
  },
  noon: {
    skyTop: '#0369a1',
    skyBottom: '#7dd3fc',
    glow: '#ffffff',
    accent: '#0ea5e9',
    silhouette: '#1e293b',
  },
  sunset: {
    skyTop: '#311042',
    skyBottom: '#ea580c',
    glow: '#facc15',
    accent: '#fb923c',
    silhouette: '#090514',
  },
  night: {
    skyTop: '#020617',
    skyBottom: '#1e1b4b',
    glow: '#38bdf8',
    accent: '#818cf8',
    silhouette: '#020617',
  },
  midnight: {
    skyTop: '#010409',
    skyBottom: '#0f172a',
    glow: '#f59e0b',
    accent: '#6366f1',
    silhouette: '#010409',
  },
};

function buildScenePrompt(
  placeName: string,
  subPlaceName: string,
  subPlaceDescription: string,
  scenarioPrompt: string,
  timeOfDay: TimeOfDay
): string {
  const lighting = TIME_LIGHTING_PROMPTS[timeOfDay] || TIME_LIGHTING_PROMPTS.night;
  const desc = subPlaceDescription?.trim()
    ? `${subPlaceDescription.trim()}.`
    : `Detailed view of ${subPlaceName} in ${placeName}.`;
  const scenarioHint = scenarioPrompt?.trim()
    ? `Setting context: ${scenarioPrompt.trim().slice(0, 180)}.`
    : '';

  return `Masterpiece wide-angle anime & visual novel background art of ${subPlaceName} (${placeName}). ${desc} ${scenarioHint} Time of day: ${lighting}. No characters, no people, empty scenic environment background, Makoto Shinkai and ufotable inspired environmental lighting, 8k resolution, highly detailed.`;
}

function generateAtmosphericSvgFallback(
  placeName: string,
  subPlaceName: string,
  timeOfDay: TimeOfDay
): string {
  const p = TIME_PALETTES[timeOfDay] || TIME_PALETTES.night;
  const isNight = timeOfDay === 'night' || timeOfDay === 'midnight' || timeOfDay === 'dawn';
  const safePlace = `${placeName} — ${subPlaceName}`.replace(/[<>&"']/g, '');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.skyTop}" />
      <stop offset="100%" stop-color="${p.skyBottom}" />
    </linearGradient>
    <radialGradient id="orb" cx="72%" cy="26%" r="38%">
      <stop offset="0%" stop-color="${p.glow}" stop-opacity="0.75" />
      <stop offset="45%" stop-color="${p.accent}" stop-opacity="0.22" />
      <stop offset="100%" stop-color="${p.skyBottom}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.skyBottom}" stop-opacity="0" />
      <stop offset="100%" stop-color="${p.silhouette}" stop-opacity="0.92" />
    </linearGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)" />
  <rect width="1600" height="900" fill="url(#orb)" />
  ${
    isNight
      ? `<g fill="#ffffff" opacity="0.45">
          <circle cx="210" cy="140" r="1.8" /><circle cx="480" cy="95" r="1.4" />
          <circle cx="760" cy="160" r="2.1" /><circle cx="1040" cy="80" r="1.5" />
          <circle cx="1360" cy="150" r="2.2" /><circle cx="1490" cy="90" r="1.3" />
          <circle cx="330" cy="240" r="1.2" /><circle cx="910" cy="220" r="1.6" />
        </g>`
      : ''
  }
  <circle cx="1150" cy="235" r="78" fill="${p.glow}" opacity="0.55" />
  <path d="M0 640 L240 530 L470 610 L760 470 L1080 590 L1340 490 L1600 580 L1600 900 L0 900 Z" fill="${p.silhouette}" opacity="0.45" />
  <g fill="${p.silhouette}" opacity="0.82">
    <rect x="90" y="470" width="170" height="430" rx="4" />
    <rect x="280" y="520" width="210" height="380" rx="4" />
    <rect x="520" y="430" width="240" height="470" rx="4" />
    <rect x="1120" y="460" width="220" height="440" rx="4" />
    <rect x="1360" y="510" width="180" height="390" rx="4" />
  </g>
  <g fill="${p.glow}" opacity="${isNight ? '0.65' : '0.22'}">
    <rect x="130" y="520" width="28" height="46" rx="3" />
    <rect x="185" y="520" width="28" height="46" rx="3" />
    <rect x="130" y="595" width="28" height="46" rx="3" />
    <rect x="565" y="485" width="36" height="58" rx="3" />
    <rect x="630" y="485" width="36" height="58" rx="3" />
    <rect x="695" y="485" width="36" height="58" rx="3" />
    <rect x="565" y="575" width="36" height="58" rx="3" />
    <rect x="630" y="575" width="36" height="58" rx="3" />
    <rect x="1165" y="520" width="34" height="54" rx="3" />
    <rect x="1230" y="520" width="34" height="54" rx="3" />
  </g>
  <rect y="520" width="1600" height="380" fill="url(#fog)" />
  <text x="80" y="845" fill="#e2e8f0" opacity="0.32" font-family="sans-serif" font-size="22" font-weight="600" letter-spacing="2">${safePlace.toUpperCase()} • ${timeOfDay.toUpperCase()}</text>
</svg>`;
}

async function saveBufferToBackgroundsDir(
  buffer: Buffer,
  ext: 'png' | 'jpg' | 'webp' | 'svg',
  roomId: string,
  subPlaceId: string,
  timeOfDay: TimeOfDay
): Promise<string> {
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'backgrounds');
  await fs.mkdir(uploadDir, { recursive: true });
  const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeSub = subPlaceId.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `bg_${safeRoom}_${safeSub}_${timeOfDay}_${Date.now()}.${ext}`;
  const fullPath = path.join(uploadDir, filename);
  await fs.writeFile(fullPath, buffer);
  return `/uploads/backgrounds/${filename}`;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await context.params;
  const details = getRoomWithDetails(roomId);
  if (!details) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const subPlaces = parseRoomSubPlaces(details.room.subPlacesJson);
  const resolved = resolveRoomLocationAndTime(details.room);

  const targetSubPlaceId: string | undefined =
    body.subPlaceId || resolved.activeSubPlace?.id || subPlaces[0]?.id;
  const targetTimeOfDay: TimeOfDay =
    (body.timeOfDay as TimeOfDay) || resolved.timeOfDay || 'night';
  const forceRegenerate = Boolean(body.forceRegenerate);
  const customImageUrl: string | undefined = body.customImageUrl;

  const targetIndex = subPlaces.findIndex((sp) => sp.id === targetSubPlaceId);
  if (targetIndex === -1) {
    return NextResponse.json(
      { error: 'Target sub-place not found in this room' },
      { status: 400 }
    );
  }

  const targetSubPlace = subPlaces[targetIndex];
  if (!targetSubPlace.backgroundsByTime) {
    targetSubPlace.backgroundsByTime = {};
  }

  // Case 1: User manually uploaded or set a custom image URL for this (subPlace, timeOfDay)
  if (customImageUrl !== undefined) {
    if (customImageUrl) {
      targetSubPlace.backgroundsByTime[targetTimeOfDay] = customImageUrl;
    } else {
      delete targetSubPlace.backgroundsByTime[targetTimeOfDay];
    }
    subPlaces[targetIndex] = targetSubPlace;
    const updated = updateRoom(roomId, {
      subPlacesJson: JSON.stringify(subPlaces),
    });
    return NextResponse.json({
      cached: false,
      provider: 'manual',
      backgroundUrl: customImageUrl || null,
      subPlaceId: targetSubPlace.id,
      timeOfDay: targetTimeOfDay,
      roomDetails: updated,
    });
  }

  // Case 2: Strict One-Time Cache Hit! Never regenerate if already cached unless forceRegenerate=true
  const existingCachedUrl = targetSubPlace.backgroundsByTime[targetTimeOfDay];
  if (existingCachedUrl && !forceRegenerate) {
    return NextResponse.json({
      cached: true,
      provider: 'cache',
      backgroundUrl: existingCachedUrl,
      subPlaceId: targetSubPlace.id,
      timeOfDay: targetTimeOfDay,
      roomDetails: details,
    });
  }

  const settings = getLlmSettings();
  const provider = body.provider || settings.imageProvider || 'pollinations';

  if (provider === 'manual_only' && !forceRegenerate) {
    return NextResponse.json({
      cached: false,
      provider: 'manual_only',
      backgroundUrl: null,
      subPlaceId: targetSubPlace.id,
      timeOfDay: targetTimeOfDay,
      roomDetails: details,
    });
  }

  const prompt =
    typeof body.customPrompt === 'string' && body.customPrompt.trim()
      ? body.customPrompt.trim()
      : buildScenePrompt(
          targetSubPlace.parentPlaceName || details.room.currentPlaceName,
          targetSubPlace.name,
          targetSubPlace.description,
          details.room.scenarioPrompt,
          targetTimeOfDay
        );

  let savedUrl: string | null = null;
  let usedProvider = provider;

  try {
    if (provider === 'openai' || provider === 'nanobanana') {
      const baseUrl = (settings.imageBaseUrl || settings.baseUrl || 'https://api.openai.com/v1').replace(
        /\/+$/,
        ''
      );
      const apiKey = settings.imageApiKey || settings.apiKey || '';
      const model =
        settings.imageModel ||
        (provider === 'nanobanana' ? 'gemini-2.5-flash-image' : 'dall-e-3');

      // Try standard /images/generations first
      const imgRes = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: '1024x1024',
        }),
        signal: AbortSignal.timeout(35000),
      });

      if (imgRes.ok) {
        const data = await imgRes.json();
        const item = data?.data?.[0];
        if (item?.b64_json) {
          const buf = Buffer.from(item.b64_json, 'base64');
          savedUrl = await saveBufferToBackgroundsDir(
            buf,
            'png',
            roomId,
            targetSubPlace.id,
            targetTimeOfDay
          );
        } else if (item?.url) {
          const dl = await fetch(item.url, { signal: AbortSignal.timeout(20000) });
          if (dl.ok) {
            const buf = Buffer.from(await dl.arrayBuffer());
            savedUrl = await saveBufferToBackgroundsDir(
              buf,
              'png',
              roomId,
              targetSubPlace.id,
              targetTimeOfDay
            );
          }
        }
      } else if (provider === 'nanobanana') {
        // Fallback for NanoBanana / Gemini multimodal chat completions endpoint that returns inline base64 or markdown image
        const chatRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: `Generate an image: ${prompt}` }],
          }),
          signal: AbortSignal.timeout(35000),
        });
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const msgContent = chatData?.choices?.[0]?.message?.content;
          if (typeof msgContent === 'string') {
            const b64Match = msgContent.match(/data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/);
            if (b64Match?.[2]) {
              const buf = Buffer.from(b64Match[2], 'base64');
              savedUrl = await saveBufferToBackgroundsDir(
                buf,
                'png',
                roomId,
                targetSubPlace.id,
                targetTimeOfDay
              );
            }
          }
        }
      }
    } else if (provider === 'sd_webui') {
      const sdBase = (settings.imageBaseUrl || 'http://127.0.0.1:7860').replace(/\/+$/, '');
      const sdRes = await fetch(`${sdBase}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negative_prompt:
            'people, person, character, portrait, text, watermark, blurry, low quality, deformed',
          width: 1024,
          height: 576,
          steps: 22,
          cfg_scale: 7,
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (sdRes.ok) {
        const sdData = await sdRes.json();
        const b64 = sdData?.images?.[0];
        if (b64) {
          const buf = Buffer.from(b64, 'base64');
          savedUrl = await saveBufferToBackgroundsDir(
            buf,
            'png',
            roomId,
            targetSubPlace.id,
            targetTimeOfDay
          );
        }
      }
    }

    // Pollinations AI (or automatic fallback if OpenAI/NanoBanana/SD wasn't configured with an active key)
    if (!savedUrl) {
      usedProvider = 'pollinations';
      const seed = Math.abs(
        Array.from(`${roomId}_${targetSubPlace.id}_${targetTimeOfDay}`).reduce(
          (acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0,
          7
        )
      );
      const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        prompt
      )}?width=1280&height=720&nologo=true&seed=${seed}`;
      const pollRes = await fetch(pollUrl, {
        headers: { 'User-Agent': 'MultiChatStudio/1.0' },
        signal: AbortSignal.timeout(25000),
      });
      if (pollRes.ok) {
        const buf = Buffer.from(await pollRes.arrayBuffer());
        if (buf.byteLength > 1024) {
          savedUrl = await saveBufferToBackgroundsDir(
            buf,
            'jpg',
            roomId,
            targetSubPlace.id,
            targetTimeOfDay
          );
        }
      }
    }
  } catch {
    // Fall through to local SVG atmospheric generator if offline or endpoint unreachable
  }

  if (!savedUrl) {
    usedProvider = 'procedural_svg';
    const svgContent = generateAtmosphericSvgFallback(
      targetSubPlace.parentPlaceName || details.room.currentPlaceName,
      targetSubPlace.name,
      targetTimeOfDay
    );
    savedUrl = await saveBufferToBackgroundsDir(
      Buffer.from(svgContent, 'utf-8'),
      'svg',
      roomId,
      targetSubPlace.id,
      targetTimeOfDay
    );
  }

  targetSubPlace.backgroundsByTime[targetTimeOfDay] = savedUrl;
  subPlaces[targetIndex] = targetSubPlace;

  const updated = updateRoom(roomId, {
    subPlacesJson: JSON.stringify(subPlaces),
  });

  return NextResponse.json({
    cached: false,
    provider: usedProvider,
    backgroundUrl: savedUrl,
    prompt,
    subPlaceId: targetSubPlace.id,
    timeOfDay: targetTimeOfDay,
    roomDetails: updated,
  });
}
