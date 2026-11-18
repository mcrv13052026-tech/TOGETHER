import axios from 'axios';

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const csrf = getCookie('ts_csrf');
  if (csrf && config.headers) {
    config.headers['X-CSRF-Token'] = csrf;
  }
  return config;
});

export interface UploadedMedia {
  id: string;
  mediaType: 'photo' | 'video' | 'audio';
  mimeType: string;
  fileSize: number;
  storageProvider: 'google_drive' | 'local_vault';
  durationSeconds: number | null;
  url: string;
  createdAt: string;
}

export async function uploadMediaFile(
  file: Blob | File,
  filename: string,
  options?: {
    durationSeconds?: number;
    onProgress?: (percent: number) => void;
  }
): Promise<UploadedMedia> {
  const formData = new FormData();
  formData.append('file', file, filename);
  if (options?.durationSeconds !== undefined) {
    formData.append('durationSeconds', String(options.durationSeconds));
  }

  const csrf = getCookie('ts_csrf');
  const res = await axios.post<{ media: UploadedMedia }>('/api/media/upload', formData, {
    withCredentials: true,
    headers: {
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    onUploadProgress: (evt) => {
      if (evt.total && options?.onProgress) {
        options.onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
  });
  return res.data.media;
}

export function extractErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(err)) {
    const serverMsg = err.response?.data?.error;
    if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
    if (err.code === 'ERR_NETWORK') return 'Network unavailable. Check your connection and retry.';
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return 'Unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let val = bytes / 1024;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx += 1;
  }
  return `${val.toFixed(val >= 10 ? 1 : 2)} ${units[unitIdx]}`;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
