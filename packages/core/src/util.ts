import { format } from 'date-fns';
import type { ZodType } from 'zod';

/** Error with an HTTP-like status so the UI can treat it like the old API errors */
export class CoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new CoreError(400, r.error.issues[0]?.message ?? '資料格式錯誤');
  return r.data;
}

export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (n: number | null | undefined) => (n ?? 0) / 100;

/** "yyyy-MM-ddTHH:mm" in device local time — comparable with occurred_at */
export const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");
export const today = () => format(new Date(), 'yyyy-MM-dd');
/** "yyyy-MM-dd HH:mm:ss" local — used for created/updated/deleted stamps */
export const stamp = (d = new Date()) => format(d, 'yyyy-MM-dd HH:mm:ss');
export const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

export const nums = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
