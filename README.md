<img src="apps/web/public/icon.svg" width="72" alt="" />

# 點滴記帳 (DianDi)

現代、簡潔、動畫流暢的多人記帳 Web App。第一至第三階段皆已完成。

## 技術架構

| 層級 | 技術 |
|---|---|
| 前端 | React 19 · TypeScript · Vite · Tailwind CSS v4 · Framer Motion · Recharts · TanStack Query · Zustand |
| 後端 | Node.js · Fastify 5 · TypeScript (tsx) |
| 資料庫 | SQLite (better-sqlite3) · Drizzle ORM |
| 共用 | `packages/shared`：Zod 驗證 schema 與型別，前後端共用 |
| 驗證 | Email + 密碼（bcrypt），JWT 存於 httpOnly Cookie |

```
ledger-app/
├─ apps/server     Fastify API + SQLite（資料存在 apps/server/data/ledger.db）
├─ apps/web        React 前端（PWA）
└─ packages/shared Zod schema / 型別
```

## 開始使用

需求：Node.js 20.19+（已在 Node 20.19.4 測試）

```bash
npm install
npm run dev          # 同時啟動 API (http://127.0.0.1:3001) 與前端 (http://localhost:5173)
```

開啟 http://localhost:5173 ，註冊帳號即可使用（註冊時會自動建立預設類別與帳戶）。

開發用測試帳號（僅存在本機開發資料庫，含示範資料）：`demo@ledger.test` / `demo12345`

> 新增套件請在專案根目錄執行 `npm install <pkg> -w apps/web`。根目錄 `package.json` 以 `optionalDependencies` 固定了 Windows 版 esbuild / rolldown 原生套件，避免 npm 在 workspace 安裝時誤刪（其他平台會自動略過）。升級 vite / tsx 時請一併更新這兩個版本號。
>
> `npm audit` 會回報 exceljs 依賴的 `uuid` 有 moderate 警告；該弱點只影響 uuid v3/v5/v6 搭配 buffer 參數，exceljs 僅使用 `v4()`，不受影響。

### 正式部署（單一服務）

```bash
npm run build        # 建置前端到 apps/web/dist
npm start            # API 同時提供前端靜態檔，預設 http://127.0.0.1:3001
```

環境變數：

| 變數 | 說明 | 預設 |
|---|---|---|
| `API_PORT` | API 監聽埠 | `3001` |
| `HOST` | 監聽位址（對外開放設 `0.0.0.0`） | `127.0.0.1` |
| `DATA_DIR` | SQLite 與金鑰存放目錄 | `apps/server/data` |
| `JWT_SECRET` | JWT 簽章金鑰（未設定會自動產生並存於 DATA_DIR） | 自動 |
| `COOKIE_SECURE` | 透過 HTTPS 提供服務時設為 `1` | 關閉 |

備份：直接複製 `DATA_DIR/ledger.db` 即可。

## 第一階段功能

- 多人帳號：註冊、登入、登出、修改名稱、變更密碼；各使用者資料完全隔離；登入失敗 5 次鎖定 5 分鐘
- 記帳：支出 / 收入 / 轉帳；計算機鍵盤（+ − × ÷，支援實體鍵盤）；日期時間選擇器（今天 / 昨天 / 前天快捷、月曆滑動切換）；類別 + 子類別；帳戶；備註；標籤
- 明細：日 / 週 / 月 / 年 / 全部切換，前後期滑動；關鍵字搜尋（備註、類別、標籤）；篩選（類型、類別、帳戶、標籤、金額區間）；依日期分組含每日小計
- 列表左滑編輯 / 刪除，刪除後可「復原」
- 類別管理：新增 / 編輯 / 刪除、子類別、自訂圖示與顏色、拖曳排序
- 帳戶管理：現金 / 銀行 / 信用卡 / 電子支付 / 其他；初始餘額、即時餘額、資產 / 負債 / 淨資產；拖曳排序
- 首頁總覽：本月結餘 / 收支（數字滾動動畫）、淨資產、本月支出排行、最近紀錄
- 淺色 / 深色 / 跟隨系統；手機優先的響應式介面（桌機側邊欄）；PWA 可加入主畫面
- 快捷鍵：`N` 新增一筆

## 第二階段功能

- **報表**：週 / 月 / 年；支出或收入的類別甜甜圈圖（點擊可展開子類別）、類別排行、收支趨勢面積圖、近 6 個月收支對比長條圖；圖表配色經色盲安全驗證
- **日曆**：每日支出熱度圖（4 階單色）、收入標記、點選日期查看當日明細並可直接記一筆
- **預算**：每月總預算 + 類別預算（含子類別）；進度環 / 進度條、接近上限（80%）與超支狀態、每日可用金額；記帳後若超支即時跳出提醒
- **定期交易**：每 N 天 / 週 / 月 / 年；開始 / 結束日期、入帳時間、暫停；伺服器啟動時、每 15 分鐘與登入時自動入帳；開始日期在過去會自動補記；月底日期正確處理（如 31 日 → 2 月 28 日）
- **常用模板**：首頁一鍵記帳（金額完整時直接入帳並可復原，否則開啟預填的記帳畫面）；記帳畫面可「存為模板」；拖曳排序
- **存錢目標**：目標金額、期限、圖示顏色；存入 / 提領紀錄；進度環動畫、每月需存金額試算、達成慶祝動畫
- 手機底部導覽改為「首頁 / 明細 / ＋ / 報表 / 更多」，「更多」集中所有功能入口；報表頁程式碼分割按需載入

## 第三階段功能

- **多幣別**：17 種常用幣別；主要幣別可設定（尚無外幣帳戶時）；外幣匯率手動設定（支援反向輸入）。每筆外幣紀錄以記帳當下匯率換算存檔，報表、預算、淨資產一律以主要幣別計算；跨幣別轉帳可填寫實際轉入金額
- **匯入 / 匯出 / 備份**：匯出 CSV（含 BOM，Excel 直接開啟中文不亂碼、防公式注入）或 Excel（.xlsx，含標題樣式與篩選）；匯入 CSV / Excel 先預覽（錯誤列標示、將自動建立的帳戶 / 類別 / 標籤）、可略過重複；完整 JSON 備份（可含收據照片）與還原
- **收據照片**：每筆最多 10 張；上傳前於瀏覽器壓縮（最長邊 1600px JPEG）；伺服器以檔頭驗證圖片格式、僅本人可存取；明細列顯示迴紋針、點縮圖放大
- **信用卡**：結帳日 / 繳款截止日；本期應繳、已繳（轉入信用卡視為繳款）、到期倒數 / 逾期提示、未出帳、未到期分期
- **分期付款**：記一筆時開啟「分期付款」選 3–36 期，自動產生每月一期（零頭放第一期、依幣別最小單位切分）；未到期的期數不計入目前餘額；可提前結清（取消剩餘期數）或整筆刪除
- **PIN 碼鎖**：4–6 位數 PIN（需登入密碼設定 / 關閉）；閒置 1 / 5 / 15 / 30 / 60 分鐘自動鎖定、可立即鎖定；**由伺服器強制執行**（鎖定時 API 回傳 423）；錯 5 次鎖 5 分鐘；忘記 PIN 可改用密碼登入

> 注意：帳戶餘額只計算「到現在為止」的紀錄，未來日期的紀錄（例如後續分期）會在到期時才計入。

## API 一覽

`/api/auth/{register,login,logout,me,password}` · `/api/accounts` · `/api/categories` · `/api/tags` ·
`/api/transactions`（GET 支援 `from,to,q,type,categoryIds,accountIds,tagIds,min,max,limit`）·
`/api/transactions/summary` · `/api/transactions/:id/restore` ·
`/api/stats/{trend,categories}` · `/api/budgets` · `/api/recurring` · `/api/templates` · `/api/goals` · `/api/goals/:id/entries` ·
`/api/rates` · `/api/settings/base-currency` · `/api/installments` · `/api/accounts/:id/cycle` ·
`/api/transactions/:id/attachments` · `/api/attachments/:id` · `/api/export/transactions?format=csv|xlsx` ·
`/api/import/{preview,commit}` · `/api/backup` · `/api/backup/restore` · `/api/auth/{pin,pin/verify,lock,ping,lock-settings}`
