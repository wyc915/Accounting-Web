# 點滴記帳 App 版：純本地架構規劃

> 分支：`mobile`（從 `main` 18e5a7f 分出，不合併回網頁版）
> 目標：iOS（App Store）與 Android（Google Play）上架、完全離線、資料只存在使用者手機上。

---

## 1. 技術選型

### 建議：Capacitor + 現有 React 前端

| 方案 | 優點 | 缺點 | 結論 |
|---|---|---|---|
| **Capacitor 7**（WebView 包 React） | 現有 React、Tailwind、Framer Motion、Recharts 介面約 80% 可直接沿用；一套程式碼同時出 iOS 與 Android；外掛生態完整（SQLCipher、生物辨識、相機） | 本質是 WebView，低階 Android 機的動畫可能掉幀；原生手感略遜 | ✅ **採用** |
| React Native / Expo | 原生元件、手勢與效能最好；Expo 有雲端 iOS 建置（EAS） | UI 幾乎要全部重寫（Tailwind → NativeWind、Framer Motion → Reanimated、Recharts → 另找圖表庫） | 備案：Capacitor 版若效能不足再考慮 |
| Flutter / 原生 Swift + Kotlin | 效能最好 | 全部重寫、兩套程式碼 | ❌ 不划算 |

選擇 Capacitor 的關鍵：這個 App 的價值在**介面與動畫**，而這些已經用 React 做好了。iOS 的 WKWebView 跑 Framer Motion 很順；Android 則要針對中低階機做效能調整（見 §6）。

### 本地資料層

| 項目 | 選用 | 說明 |
|---|---|---|
| 資料庫 | `@capacitor-community/sqlite` + **SQLCipher** | 原生 SQLite，整個資料庫 AES-256 加密 |
| 金鑰保存 | iOS **Keychain**／Android **Keystore** | 由 sqlite 外掛產生並保管密碼，App 程式碼不接觸明文金鑰 |
| ORM | **Drizzle**（`sqlite-proxy` driver） | 沿用現有 `schema.ts` 與查詢寫法，底層改接 Capacitor SQLite |
| 照片 | `@capacitor/filesystem` 存在 App 私有目錄 | iOS 加上檔案保護（Complete），Android 為 App 私有儲存 |
| 設定值 | `@capacitor/preferences` | 主題、上次使用帳戶等非敏感設定 |

---

## 2. 架構

### 網頁版（main）→ App 版（mobile）

```
網頁版（現在）                                  App 版（目標）
┌──────────────┐   HTTP / Cookie   ┌──────────────┐        ┌───────────────────────────────┐
│ React (web)  │ ────────────────▶ │ Fastify API  │        │ React UI（沿用 apps/web）       │
│ TanStack Q.  │ ◀──────────────── │ + SQLite     │   ⇒    │ TanStack Query                  │
└──────────────┘                   └──────────────┘        │        │ 直接函式呼叫（無網路）    │
                                                           │ packages/core（業務邏輯）        │
                                                           │        │ Drizzle (sqlite-proxy)  │
                                                           │ Capacitor SQLite + SQLCipher     │
                                                           │ Keychain / Keystore（金鑰）       │
                                                           └───────────────────────────────┘
```

### 目錄結構（mobile 分支）

```
ledger-app/
├─ packages/
│  ├─ shared/        Zod schema、型別、幣別表（沿用，移除 auth 相關）
│  └─ core/          ★新增：從 apps/server 抽出的業務邏輯，與框架無關
│     ├─ db/         schema.ts、migrations（版本化）、Db 介面
│     ├─ services/   accounts、categories、transactions、stats、budgets、
│     │              recurring、installments、templates、goals、currency、
│     │              importExport、backup、cardCycle
│     └─ tests/      vitest：在 Node 用 better-sqlite3 跑同一套 service 測試
├─ apps/
│  └─ mobile/        ★由 apps/web 搬移而來
│     ├─ src/        React UI（沿用）＋ lib/local.ts 取代 lib/api.ts
│     ├─ ios/        Capacitor 產生的 Xcode 專案
│     ├─ android/    Capacitor 產生的 Android Studio 專案
│     └─ capacitor.config.ts
└─ docs/MOBILE_PLAN.md
```

`apps/server` 與 `apps/web` 在抽出 `core` 之後就從 mobile 分支移除。

### 關鍵設計：core 與資料庫解耦

```ts
// packages/core/db/types.ts
export interface Db {                       // 兩種實作，同一套業務邏輯
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastId: number }>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
// App：CapacitorDb（@capacitor-community/sqlite + SQLCipher）
// 測試：NodeDb（better-sqlite3，跑在 vitest，CI 可自動測）
```

前端只換掉資料來源，TanStack Query 的 hooks 幾乎不動：

```ts
// 現在：queryFn: () => api.get<Account[]>('/accounts')
// App ：queryFn: () => core.accounts.list()
```

---

## 3. 從網頁版的改動清單

### 移除
| 項目 | 原因 |
|---|---|
| Fastify 伺服器、所有 HTTP API | 不再有伺服器 |
| 註冊、登入、登出、多使用者、`user_id` 欄位 | 一支手機一位使用者 |
| JWT、Cookie、登入防暴力破解 | 沒有遠端登入 |
| 伺服器端 PIN 鎖（423 機制） | 改為原生生物辨識鎖（見下） |
| multipart 上傳、靜態檔服務 | 改為本地檔案 |
| Google Fonts 線上字型 | 離線無法載入，改為內建字型 |

### 修改
| 項目 | 網頁版 | App 版 |
|---|---|---|
| 資料存取 | `fetch('/api/...')` | 直接呼叫 `core` 函式 |
| 資料庫 | 伺服器 SQLite（明碼） | 手機 SQLite + **SQLCipher 加密** |
| 定期交易入帳 | 伺服器每 15 分鐘 | App 啟動與回到前景時補記；搭配本地通知提醒 |
| 收據照片 | 上傳到伺服器 | 相機拍照或相簿選取 → 壓縮 → 存 App 私有目錄 |
| 匯出 CSV／Excel | 瀏覽器下載 | 產生檔案 → 系統分享選單（存到「檔案」、雲端硬碟、LINE 等） |
| 匯入 | 上傳檔案 | 系統檔案選擇器 → 本地解析（exceljs 延遲載入） |
| 備份 | 明碼 JSON | **密碼加密備份**（PBKDF2 + AES-GCM），可存到 iCloud Drive／Google Drive |
| PIN 鎖 | 伺服器強制 | Face ID／Touch ID／指紋，PIN 作為備援；**解鎖後才開啟資料庫**（金鑰受生物辨識保護） |
| 首次使用 | 註冊帳號 | 引導頁：選主要幣別 → 設定帳戶 → 是否開啟生物辨識 |
| 返回操作 | 瀏覽器上一頁 | iOS 邊緣滑動返回；Android 返回鍵／手勢先關閉彈出面板 |

### 新增（原生能力，也有助通過 Apple 審查 4.2「最低功能要求」）
- 生物辨識解鎖＋隱私遮罩：切到背景時模糊畫面，多工切換畫面看不到金額
- 本地通知：信用卡繳款日、預算接近上限、定期交易入帳
- 觸覺回饋：數字鍵盤、儲存成功、刪除
- 狀態列、啟動畫面、安全區域（瀏海、Home 指示條）適配
- 後續可考慮：桌面小工具（今日支出、本月預算），需要原生程式碼

---

## 4. iOS 與 Android 差異

| 項目 | iOS | Android | 對應作法 |
|---|---|---|---|
| **建置環境** | **必須用 macOS + Xcode** | Windows 的 Android Studio 即可 | ⚠ 你目前用 Windows：Android 先在本機開發；iOS 用雲端 Mac 建置（Codemagic／GitHub Actions macOS runner）上傳 TestFlight，或租用／購買 Mac mini |
| 開發者帳號 | Apple Developer Program **US$99／年** | Google Play **US$25 一次** | — |
| 首次上架門檻 | 審查約 1–3 天 | **新個人帳號需先做封閉測試：至少 12 位測試者、連續 14 天**，才能申請正式上架 | Android 要提早找測試者 |
| WebView | WKWebView，各機型表現一致且流暢 | Android System WebView（Chromium），**中低階機效能差異大** | Android 減少 `backdrop-blur`、大面積模糊與陰影；長列表做虛擬化 |
| 金鑰保存 | Keychain（`ThisDeviceOnly`） | Keystore（硬體支援時存於 TEE／StrongBox） | sqlite 外掛已封裝 |
| 生物辨識 | Face ID／Touch ID，Info.plist 需填 `NSFaceIDUsageDescription` | BiometricPrompt，需區分 Class 3（強）與 Class 2（弱） | 解鎖資料庫金鑰只接受強生物辨識；其餘情況改用 PIN |
| 靜態資料保護 | Data Protection：`NSFileProtectionComplete`（鎖機後無法讀取） | 檔案層級加密（Android 10+ 預設）＋ App 沙盒 | 兩邊都再加一層 SQLCipher |
| 系統備份 | iCloud 備份會包含 App 資料 | Auto Backup 預設會備份 | 資料庫標記為不備份（金鑰綁裝置，換機也無法解開）；**改以加密備份檔搬家** |
| 隱私遮罩 | 進入背景時加遮罩（多工畫面截圖） | `FLAG_SECURE`（同時禁止截圖、錄影） | 隱私遮罩外掛，Android 可讓使用者選擇是否禁止截圖 |
| 相機／相簿權限 | Info.plist 需填用途說明 | Android 13+ 的照片選擇器**不需權限**；拍照需相機權限 | 優先用系統照片選擇器 |
| 通知權限 | 首次需詢問 | Android 13+ 需執行期 `POST_NOTIFICATIONS`；精準鬧鐘受限 | 提醒用「非精準」排程即可（繳款日不需精確到分） |
| 返回操作 | 左緣滑動返回 | 實體或手勢返回鍵 | 監聽 `backButton`：先關面板 → 再上一頁 → 最後才離開 App |
| 鍵盤 | 數字鍵盤樣式不同；會推擠畫面 | `adjustResize` 行為不同 | 記帳主要用自製鍵盤，影響小；表單頁統一用 Keyboard 外掛處理 |
| 觸覺回饋 | Taptic Engine，細膩 | 各機型差異大 | 使用 Haptics 外掛的 impact／notification 等級 |
| App 圖示 | 1024×1024、**不可透明** | 自適應圖示（前景＋背景兩層）＋ Android 13 單色主題圖示 | 從新的三水滴 SVG 產生全套（`@capacitor/assets`） |
| 檔案分享 | 分享選單 →「檔案」App／iCloud Drive | 分享選單／系統檔案框架（SAF） | `@capacitor/share` 兩邊共用 |
| 審查重點 | 隱私清單 `PrivacyInfo.xcprivacy`（宣告 UserDefaults、檔案時間戳等 API 用途）、隱私標籤、加密出口合規、4.2 最低功能 | Data safety 表單、目標 API 等級（每年提高）、隱私權政策網址 | 純本地＝「不收集資料」；SQLCipher 屬資料保護用途，可申報豁免 |
| 未來收費 | 數位功能必須用 Apple 內購（IAP） | Google Play Billing | 第一版先免費 |

---

## 5. 安全設計（純本地版）

| 威脅 | 對策 |
|---|---|
| 手機遺失或被他人使用 | SQLCipher 加密資料庫；金鑰存 Keychain／Keystore；生物辨識成功才開啟資料庫 |
| 多工切換畫面洩漏金額 | 進入背景即顯示隱私遮罩 |
| 匯出、備份檔外流 | 備份一律要求設定密碼（PBKDF2 210k 次 + AES-256-GCM）；CSV 匯出前提示「檔案為明碼」 |
| 越獄、Root 裝置 | 無法完全防止；App 內不放任何密鑰；可偵測並提示風險 |
| 惡意匯入檔（zip bomb、超大檔） | 保留檔案大小限制、列數上限；xlsx 解壓縮大小上限 |
| WebView XSS | 不載入任何遠端內容；嚴格 CSP；React 預設跳脫、不使用 `dangerouslySetInnerHTML` |
| 第三方 SDK 外洩資料 | **不加入**分析、廣告、崩潰回報 SDK（或僅用不含個資的選項，並如實申報） |
| 套件供應鏈 | 鎖定版本、定期 `npm audit`；原生外掛只用社群主流套件 |

---

## 6. 效能與體驗調整

- **Android 動畫**：Framer Motion 只動 `transform`、`opacity`；中低階機降低 `backdrop-blur`；尊重系統「減少動態效果」
- **長列表**：明細超過數百筆時用 `react-virtuoso` 虛擬捲動
- **啟動速度**：路由層級程式碼分割（報表、Excel 匯入匯出延遲載入）；資料庫在解鎖時才開啟
- **字型**：內建 Inter + Noto Sans TC 子集（常用 4,000 字）以控制 App 大小
- **大量資料**：統計查詢加索引；10 萬筆紀錄壓力測試

---

## 7. 里程碑

| # | 階段 | 主要工作 | 完成標準 |
|---|---|---|---|
| M0 | 專案骨架 | 建立 `apps/mobile`（搬移 web）、`packages/core`；`npx cap add android ios` | Android 模擬器能開啟現有畫面（假資料） |
| M1 | 業務邏輯抽離 | 從 `apps/server` 抽出 services 到 `core`、移除 `user_id`、版本化 migration；vitest 移植現有 39 項 API 測試 | core 測試在 Node 全數通過 |
| M2 | 本地資料庫 | Capacitor SQLite + SQLCipher；`lib/local.ts` 取代 `lib/api.ts`；拿掉登入流程；首次使用引導 | 真機上記帳、報表、預算、定期、分期全部可用且離線 |
| M3 | 原生能力 | 生物辨識＋PIN 鎖、隱私遮罩、相機收據、觸覺回饋、返回鍵、安全區域、內建字型 | 雙平台實機測試通過 |
| M4 | 資料進出 | 分享選單匯出 CSV／Excel、檔案選擇器匯入、加密備份與還原、本地通知 | 換機流程：舊機備份 → 新機還原成功 |
| M5 | 上架準備 | 圖示與啟動畫面、隱私清單、Data safety、隱私權政策頁、簽章；Android 封閉測試（12 人 × 14 天）；iOS TestFlight | 送審 |

建議順序：**先做 Android**（可在你現有的 Windows 環境完成），等 M3 穩定後再接上雲端 Mac 建置 iOS。

---

## 8. 需要你決定或準備的事

1. **iOS 建置環境**：雲端建置服務（Codemagic 有免費額度）或實體 Mac
2. **開發者帳號**：Apple US$99／年、Google Play US$25
3. **Bundle ID／套件名稱**：例如 `com.wyc915.diandi`（上架後不可更改）
4. **隱私權政策頁面**：兩個商店都要求網址（純本地 App 內容很簡短，可用 GitHub Pages）
5. **Android 封閉測試的 12 位測試者**
6. **網頁版資料是否要搬到 App**：可以用網頁版的「完整備份」匯出，App 提供匯入舊格式備份的功能

---

## 9. 分支策略

- `main`：網頁版（維持現狀，可繼續小修）
- `mobile`：App 版，**不合併回 main**；`apps/server`、`apps/web` 會在 M1 之後從此分支移除
- 兩邊共用的 `packages/shared` 若修正錯誤，用 `git cherry-pick` 手動同步
- 若未來 App 成為唯一產品，可考慮把 `mobile` 拆成獨立的 repo
