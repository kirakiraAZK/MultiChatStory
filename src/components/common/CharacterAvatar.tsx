'use client';

import React from 'react';

interface CharacterAvatarProps {
  name: string;
  avatarColor?: string | null;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  badgeText?: string;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<CharacterAvatarProps['size']>, string> = {
  xs: 'h-5 w-5 text-[10px] rounded-md',
  sm: 'h-7 w-7 text-xs rounded-lg',
  md: 'h-9 w-9 text-xs rounded-xl',
  lg: 'h-12 w-12 text-sm rounded-xl',
  xl: 'h-16 w-16 text-base rounded-2xl',
};

export function CharacterAvatar({
  name,
  avatarColor = '#6366f1',
  avatarUrl,
  size = 'md',
  badgeText,
  className = '',
}: CharacterAvatarProps) {
  const initials =
    badgeText ||
    name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() ||
    'AI';

  return (
    <div
      className={`relative shrink-0 overflow-hidden flex items-center justify-center font-bold text-white shadow-sm ${SIZE_CLASSES[size]} ${className}`}
      style={{ backgroundColor: avatarColor || '#6366f1' }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
