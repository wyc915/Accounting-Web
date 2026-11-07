/** Minimal async SQLite interface — implemented by the Capacitor adapter (app) and better-sqlite3 (tests). */
export type Param = string | number | null;

export interface Db {
  run(sql: string, params?: Param[]): Promise<{ changes: number; lastId: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  /** multiple statements, no params */
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/** Thin helper layer every service uses */
export class Sql {
  private depth = 0;
  constructor(public readonly db: Db) {}

  run(sql: string, params: Param[] = []) {
    return this.db.run(sql, params);
  }
  all<T = Record<string, unknown>>(sql: string, params: Param[] = []) {
    return this.db.all<T>(sql, params);
  }
  async get<T = Record<string, unknown>>(sql: string, params: Param[] = []): Promise<T | undefined> {
    return (await this.db.all<T>(sql, params))[0];
  }
  async insert(sql: string, params: Param[] = []) {
    return (await this.db.run(sql, params)).lastId;
  }
  /** nested-safe transaction */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) {
      this.depth++;
      try {
        return await fn();
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    await this.db.begin();
    try {
      const r = await fn();
      await this.db.commit();
      return r;
    } catch (e) {
      await this.db.rollback().catch(() => {});
      throw e;
    } finally {
      this.depth = 0;
    }
  }
}

export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(',');
