import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { goalEntryInput, goalInput, reorderInput, templateInput, type Goal, type Template, type TemplateInput } from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { assertAccount } from './accounts.js';
import { assertCategory } from './categories.js';

const { templates, goals, goalEntries } = schema;

/* ---------------- Templates ---------------- */
const tplDto = (r: typeof templates.$inferSelect): Template => ({
  id: r.id,
  name: r.name,
  type: r.type as Template['type'],
  amount: r.amount == null ? null : fromCents(r.amount),
  accountId: r.accountId,
  toAccountId: r.toAccountId,
  categoryId: r.categoryId,
  note: r.note,
  sort: r.sort,
});

function validateTpl(uid: number, b: TemplateInput) {
  if (b.accountId != null) assertAccount(uid, b.accountId);
  if (b.type === 'transfer') {
    if (b.toAccountId != null) assertAccount(uid, b.toAccountId);
    b.categoryId = null;
  } else {
    b.toAccountId = null;
    if (b.categoryId != null) assertCategory(uid, b.categoryId, b.type);
  }
}

/* ---------------- Goals ---------------- */
const goalSaved = sqlite.prepare(`SELECT goal_id, COALESCE(SUM(amount),0) s FROM goal_entries WHERE user_id = ? GROUP BY goal_id`);
function listGoals(uid: number): Goal[] {
  const saved = new Map((goalSaved.all(uid) as { goal_id: number; s: number }[]).map((r) => [r.goal_id, r.s]));
  return db
    .select()
    .from(goals)
    .where(eq(goals.userId, uid))
    .orderBy(asc(goals.sort), asc(goals.id))
    .all()
    .map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      color: g.color,
      target: fromCents(g.target),
      deadline: g.deadline,
      sort: g.sort,
      createdAt: g.createdAt,
      saved: fromCents(saved.get(g.id) ?? 0),
    }));
}
function ownedGoal(uid: number, id: number) {
  const g = db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, uid))).get();
  if (!g) throw new HttpError(404, '目標不存在');
  return g;
}

export async function extraRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /* templates */
  app.get('/api/templates', async (req) =>
    db.select().from(templates).where(eq(templates.userId, req.user.uid)).orderBy(asc(templates.sort), asc(templates.id)).all().map(tplDto),
  );
  app.post('/api/templates', async (req) => {
    const uid = req.user.uid;
    const b = parse(templateInput, req.body);
    validateTpl(uid, b);
    const max = db.select({ m: sql<number>`COALESCE(MAX(${templates.sort}), -1)` }).from(templates).where(eq(templates.userId, uid)).get();
    return tplDto(
      db.insert(templates).values({ ...b, userId: uid, amount: b.amount == null ? null : toCents(b.amount), sort: (max?.m ?? -1) + 1 }).returning().get(),
    );
  });
  app.put('/api/templates/reorder', async (req) => {
    const { ids } = parse(reorderInput, req.body);
    const uid = req.user.uid;
    db.transaction((t) => ids.forEach((id, i) => t.update(templates).set({ sort: i }).where(and(eq(templates.id, id), eq(templates.userId, uid))).run()));
    return { ok: true };
  });
  app.put('/api/templates/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const b = parse(templateInput, req.body);
    validateTpl(uid, b);
    const r = db
      .update(templates)
      .set({ ...b, amount: b.amount == null ? null : toCents(b.amount) })
      .where(and(eq(templates.id, id), eq(templates.userId, uid)))
      .returning()
      .get();
    if (!r) throw new HttpError(404, '模板不存在');
    return tplDto(r);
  });
  app.delete('/api/templates/:id', async (req) => {
    const id = idParam(req.params);
    db.delete(templates).where(and(eq(templates.id, id), eq(templates.userId, req.user.uid))).run();
    return { ok: true };
  });

  /* goals */
  app.get('/api/goals', async (req) => listGoals(req.user.uid));
  app.post('/api/goals', async (req) => {
    const uid = req.user.uid;
    const b = parse(goalInput, req.body);
    const max = db.select({ m: sql<number>`COALESCE(MAX(${goals.sort}), -1)` }).from(goals).where(eq(goals.userId, uid)).get();
    const r = db.insert(goals).values({ ...b, userId: uid, target: toCents(b.target), sort: (max?.m ?? -1) + 1 }).returning().get();
    return listGoals(uid).find((g) => g.id === r.id);
  });
  app.put('/api/goals/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    ownedGoal(uid, id);
    const b = parse(goalInput, req.body);
    db.update(goals).set({ ...b, target: toCents(b.target) }).where(eq(goals.id, id)).run();
    return listGoals(uid).find((g) => g.id === id);
  });
  app.delete('/api/goals/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    ownedGoal(uid, id);
    db.delete(goals).where(eq(goals.id, id)).run();
    return { ok: true };
  });
  app.get('/api/goals/:id/entries', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    ownedGoal(uid, id);
    return db
      .select()
      .from(goalEntries)
      .where(eq(goalEntries.goalId, id))
      .orderBy(sql`${goalEntries.id} DESC`)
      .all()
      .map((e) => ({ id: e.id, amount: fromCents(e.amount), note: e.note, createdAt: e.createdAt }));
  });
  app.post('/api/goals/:id/entries', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    ownedGoal(uid, id);
    const b = parse(goalEntryInput, req.body);
    const saved = listGoals(uid).find((g) => g.id === id)!.saved;
    if (saved + b.amount < 0) throw new HttpError(400, '提領金額不可超過已存金額');
    db.insert(goalEntries).values({ goalId: id, userId: uid, amount: toCents(b.amount), note: b.note }).run();
    return listGoals(uid).find((g) => g.id === id);
  });
  app.delete('/api/goals/:id/entries/:entryId', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const entryId = Number((req.params as { entryId: string }).entryId);
    db.delete(goalEntries).where(and(eq(goalEntries.id, entryId), eq(goalEntries.goalId, id), eq(goalEntries.userId, uid))).run();
    return listGoals(uid).find((g) => g.id === id);
  });
}
