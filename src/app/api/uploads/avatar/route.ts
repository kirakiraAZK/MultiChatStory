import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    const allowedTypes: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };

    const ext = allowedTypes[file.type] || 'png';
    const fileName = `avatar_${ulid().toLowerCase()}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
    await fs.mkdir(uploadDir, { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(path.join(uploadDir, fileName), Buffer.from(arrayBuffer));

    return NextResponse.json({
      avatarUrl: `/uploads/avatars/${fileName}`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload avatar' },
      { status: 500 }
    );
  }
}
