import { Ctx } from './ctx.js';
import { Sql, type Db } from './db.js';
import { migrate } from './schema.js';
import { accountsService, categoriesService } from './services/accounts.js';
import { appService } from './services/app.js';
import { dataService } from './services/data.js';
import { goalsService, installmentsService, templatesService } from './services/extras.js';
import { recurringService, statsService } from './services/planning.js';
import { transactionsService } from './services/transactions.js';

export type { Db, Param } from './db.js';
export { CoreError } from './util.js';
export { encryptText, decryptText, isEncrypted } from './services/data.js';

/** All business logic of 點滴記帳, running on-device against any `Db` implementation */
export function createCore(db: Db) {
  const sql = new Sql(db);
  const ctx = new Ctx(sql);
  const core = {
    ctx,
    app: appService(ctx),
    accounts: accountsService(ctx),
    categories: categoriesService(ctx),
    transactions: transactionsService(ctx),
    stats: statsService(ctx),
    recurring: recurringService(ctx),
    templates: templatesService(ctx),
    goals: goalsService(ctx),
    installments: installmentsService(ctx),
    data: dataService(ctx),
    /** run migrations; post due recurring items */
    async init() {
      const version = await migrate(sql);
      if ((await ctx.getSetting('onboarded')) === '1') await core.recurring.process().catch(() => 0);
      return version;
    },
  };
  return core;
}
export type Core = ReturnType<typeof createCore>;
