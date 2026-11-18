import { useState } from 'react';

interface AvatarProps {
  name: string;
  avatarMediaId?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  ring?: boolean;
}

const SIZE_MAP = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export function Avatar({ name, avatarMediaId, size = 'md', online, ring }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className={`relative inline-flex shrink-0 ${ring ? 'p-0.5 rounded-full bg-gradient-to-tr from-rose-500 to-amber-500' : ''}`}>
      <div
        className={`${SIZE_MAP[size]} rounded-full overflow-hidden flex items-center justify-center font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 ${
          ring ? 'ring-2 ring-white dark:ring-zinc-950' : ''
        }`}
      >
        {avatarMediaId && !imgError ? (
          <img
            src={`/api/media/stream/${avatarMediaId}`}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initials || 'TS'}</span>
        )}
      </div>
      {online && (
        <span
          title="Active now"
          aria-label="Active now"
          className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950"
        />
      )}
    </div>
  );
}
