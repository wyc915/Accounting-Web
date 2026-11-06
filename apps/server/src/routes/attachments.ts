import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, schema, UPLOAD_DIR } from '../db/index.js';
import { HttpError, idParam } from '../util.js';

const { attachments, transactions } = schema;
const MAX_PER_TX = 10;
export const MAX_FILE = 10 * 1024 * 1024;

/** detect image type from magic bytes (never trust the client's mime) */
export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return { mime: 'image/gif', ext: 'gif' };
  return null;
}

const userDir = (uid: number) => {
  const d = resolve(UPLOAD_DIR, String(uid));
  mkdirSync(d, { recursive: true });
  return d;
};

/** write an image for a transaction; returns attachment id */
export function storeAttachment(uid: number, txId: number, buf: Buffer) {
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(400, '只接受 JPG、PNG、WEBP、GIF 圖片');
  if (buf.length > MAX_FILE) throw new HttpError(400, '圖片不可超過 10MB');
  const file = `${randomBytes(16).toString('hex')}.${kind.ext}`;
  writeFileSync(resolve(userDir(uid), file), buf);
  return db.insert(attachments).values({ userId: uid, transactionId: txId, file, mime: kind.mime, size: buf.length }).returning().get();
}

export function removeAttachmentFiles(uid: number, txIds: number[]) {
  if (!txIds.length) return;
  const rows = db.select().from(attachments).where(and(eq(attachments.userId, uid), inArray(attachments.transactionId, txIds))).all();
  for (const r of rows) {
    try {
      unlinkSync(resolve(userDir(uid), r.file));
    } catch {
      /* already gone */
    }
  }
}

export function attachmentPath(uid: number, file: string) {
  return resolve(userDir(uid), file);
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/api/transactions/:id/attachments', async (req) => {
    const uid = req.user.uid;
    const txId = idParam(req.params);
    const t = db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.id, txId), eq(transactions.userId, uid))).get();
    if (!t) throw new HttpError(404, '紀錄不存在');
    const count = db.select({ id: attachments.id }).from(attachments).where(eq(attachments.transactionId, txId)).all().length;
    if (count >= MAX_PER_TX) throw new HttpError(400, `每筆紀錄最多 ${MAX_PER_TX} 張照片`);
    const part = await req.file();
    if (!part) throw new HttpError(400, '沒有收到檔案');
    const buf = await part.toBuffer();
    const row = storeAttachment(uid, txId, buf);
    return { id: row.id, size: row.size, mime: row.mime };
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const a = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, uid))).get();
    if (!a) throw new HttpError(404, '照片不存在');
    const p = attachmentPath(uid, a.file);
    if (!existsSync(p)) throw new HttpError(404, '照片檔案遺失');
    reply
      .header('content-type', a.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'");
    return reply.send(createReadStream(p));
  });

  app.delete('/api/attachments/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const a = db.select().from(attachments).where(and(eq(attachments.id, id), eq(attachments.userId, uid))).get();
    if (!a) throw new HttpError(404, '照片不存在');
    try {
      unlinkSync(attachmentPath(uid, a.file));
    } catch {
      /* ignore */
    }
    db.delete(attachments).where(eq(attachments.id, id)).run();
    return { ok: true };
  });
}
