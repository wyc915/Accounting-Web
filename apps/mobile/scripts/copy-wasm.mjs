// jeep-sqlite 2.8 (browser dev mode) bundles sql.js 1.11 glue → needs the matching 1.11 WASM at /assets/sql-wasm.wasm
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = createRequire(import.meta.url).resolve('sql.js-jeep/dist/sql-wasm.wasm');
const dest = resolve(here, '../public/assets/sql-wasm.wasm');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
