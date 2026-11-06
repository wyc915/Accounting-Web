import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { categoryInput, reorderInput, tagInput, type Category } from '@ledger/shared';
import { db, schema } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';

const { categories, tags } = schema;

const toDto = (r: typeof categories.$inferSelect): Category => ({
  id: r.id,
  name: r.name,
  type: r.type as Category['type'],
  icon: r.icon,
  color: r.color,
  parentId: r.parentId,
  sort: r.sort,
});

function getOwned(uid: number, id: number) {
  const c = db.select().from(categories).where(and(eq(categories.id, id), eq(categories.userId, uid))).get();
  if (!c) throw new HttpError(404, '類別不存在');
  return c;
}

export function assertCategory(uid: number, id: number, type: string) {
  const c = getOwned(uid, id);
  if (c.type !== type) throw new HttpError(400, '類別與收支類型不符');
}

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/categories', async (req) =>
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, req.user.uid))
      .orderBy(asc(categories.sort), asc(categories.id))
      .all()
      .map(toDto),
  );

  app.post('/api/categories', async (req) => {
    const b = parse(categoryInput, req.body);
    const uid = req.user.uid;
    if (b.parentId != null) {
      const p = getOwned(uid, b.parentId);
      if (p.parentId != null) throw new HttpError(400, '子類別下不可再建立子類別');
      if (p.type !== b.type) throw new HttpError(400, '子類別需與父類別同類型');
    }
    const max = db
      .select({ m: sql<number>`COALESCE(MAX(${categories.sort}), -1)` })
      .from(categories)
      .where(eq(categories.userId, uid))
      .get();
    return toDto(db.insert(categories).values({ ...b, userId: uid, sort: (max?.m ?? -1) + 1 }).returning().get());
  });

  app.put('/api/categories/reorder', async (req) => {
    const { ids } = parse(reorderInput, req.body);
    const uid = req.user.uid;
    db.transaction((tx) => {
      ids.forEach((id, i) =>
        tx.update(categories).set({ sort: i }).where(and(eq(categories.id, id), eq(categories.userId, uid))).run(),
      );
    });
    return { ok: true };
  });

  app.put('/api/categories/:id', async (req) => {
    const id = idParam(req.params);
    const uid = req.user.uid;
    const cur = getOwned(uid, id);
    const b = parse(categoryInput, req.body);
    // type & parent are fixed after creation to keep history consistent
    const row = db
      .update(categories)
      .set({ name: b.name, icon: b.icon, color: b.color })
      .where(and(eq(categories.id, cur.id), eq(categories.userId, uid)))
      .returning()
      .get();
    return toDto(row!);
  });

  app.delete('/api/categories/:id', async (req) => {
    const id = idParam(req.params);
    const uid = req.user.uid;
    getOwned(uid, id);
    // children cascade; transactions become uncategorized (ON DELETE SET NULL)
    db.delete(categories).where(and(eq(categories.id, id), eq(categories.userId, uid))).run();
    return { ok: true };
  });

  /* ---------- Tags ---------- */
  app.get('/api/tags', async (req) =>
    db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).where(eq(tags.userId, req.user.uid)).orderBy(asc(tags.name)).all(),
  );

  app.post('/api/tags', async (req) => {
    const b = parse(tagInput, req.body);
    const uid = req.user.uid;
    const exist = db.select().from(tags).where(and(eq(tags.userId, uid), eq(tags.name, b.name))).get();
    if (exist) return { id: exist.id, name: exist.name, color: exist.color };
    const r = db.insert(tags).values({ ...b, userId: uid }).returning().get();
    return { id: r.id, name: r.name, color: r.color };
  });

  app.delete('/api/tags/:id', async (req) => {
    const id = idParam(req.params);
    db.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, req.user.uid))).run();
    return { ok: true };
  });
}
