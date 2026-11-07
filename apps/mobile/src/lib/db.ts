import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { createCore, type Core, type Db, type Param } from '@ledger/core';

const DB_NAME = 'diandi';
const isWeb = Capacitor.getPlatform() === 'web';

/** random 32-byte passphrase, generated once and stored by the plugin in Keystore/Keychain */
function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function openConnection(): Promise<{ conn: SQLiteDBConnection; sqlite: SQLiteConnection }> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  if (isWeb) {
    // browser dev mode: sql.js (WASM) persisted to IndexedDB via <jeep-sqlite> — not encrypted
    const { JeepSqlite } = await import('jeep-sqlite/dist/components/jeep-sqlite');
    if (!customElements.get('jeep-sqlite')) customElements.define('jeep-sqlite', JeepSqlite);
    if (!document.querySelector('jeep-sqlite')) document.body.appendChild(document.createElement('jeep-sqlite'));
    await customElements.whenDefined('jeep-sqlite');
    await sqlite.initWebStore();
  }
  let encrypted = false;
  let mode = 'no-encryption';
  if (!isWeb) {
    const { result: supported } = await sqlite.isInConfigEncryption();
    if (supported) {
      const { result: stored } = await sqlite.isSecretStored();
      if (!stored) await sqlite.setEncryptionSecret(randomSecret());
      encrypted = true;
      mode = 'secret';
    }
  }
  const exists = (await sqlite.checkConnectionsConsistency()).result && (await sqlite.isConnection(DB_NAME, false)).result;
  const conn = exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, encrypted, mode, 1, false);
  await conn.open();
  return { conn, sqlite };
}

function adapter(conn: SQLiteDBConnection, sqlite: SQLiteConnection): Db {
  let inTx = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // web only: flush the in-memory sql.js DB to IndexedDB shortly after writes
  const persist = () => {
    if (!isWeb || inTx) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => sqlite.saveToStore(DB_NAME).catch(() => {}), 250);
  };
  const vals = (p: Param[] = []) => p.map((v) => (v === undefined ? null : v));
  return {
    async run(sql, params) {
      const r = await conn.run(sql, vals(params), false);
      persist();
      return { changes: r.changes?.changes ?? 0, lastId: r.changes?.lastId ?? 0 };
    },
    async all(sql, params) {
      const r = await conn.query(sql, vals(params));
      return (r.values ?? []) as never;
    },
    async exec(sql) {
      await conn.execute(sql, false);
      persist();
    },
    async begin() {
      await conn.beginTransaction();
      inTx = true;
    },
    async commit() {
      await conn.commitTransaction();
      inTx = false;
      persist();
    },
    async rollback() {
      inTx = false;
      await conn.rollbackTransaction();
    },
  };
}

let corePromise: Promise<Core> | null = null;
/** lazily opens the encrypted DB, runs migrations, returns the core services */
export function getCore(): Promise<Core> {
  corePromise ??= (async () => {
    const { conn, sqlite } = await openConnection();
    const core = createCore(adapter(conn, sqlite));
    await core.init();
    return core;
  })();
  corePromise.catch(() => (corePromise = null));
  return corePromise;
}

export const platform = Capacitor.getPlatform();
export const isNative = Capacitor.isNativePlatform();
