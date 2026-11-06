export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response, url: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    if (res.status === 423) window.dispatchEvent(new Event('app:locked'));
    throw new ApiError(res.status, (data as { message?: string }).message ?? '發生錯誤');
  }
  return data as T;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle<T>(res, url);
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
  /** multipart upload of a single file */
  upload: async <T>(url: string, file: Blob, name = 'file') => {
    const fd = new FormData();
    fd.append('file', file, name);
    const res = await fetch(`/api${url}`, { method: 'POST', credentials: 'include', body: fd });
    return handle<T>(res, url);
  },
  /** download a file response and hand it to the browser */
  download: async (url: string, fallbackName: string) => {
    const res = await fetch(`/api${url}`, { credentials: 'include' });
    if (!res.ok) return handle(res, url);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = cd.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

export const qs = (o: Record<string, string | number | undefined | null | (string | number)[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Resize/compress a photo in the browser before upload (max 1600px, JPEG ~0.82) */
export async function compressImage(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  return blob && blob.size < file.size ? blob : file;
}
