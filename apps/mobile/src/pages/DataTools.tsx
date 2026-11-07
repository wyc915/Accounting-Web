import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { addYears, startOfMonth, startOfYear, addMonths } from 'date-fns';
import { AlertTriangle, ArchiveRestore, DatabaseBackup, Download, FileSpreadsheet, FileText, Upload } from 'lucide-react';
import type { ImportPreview } from '@ledger/shared';
import { isEncrypted } from '@ledger/core';
import { api, qs } from '@/lib/api';
import { cn, money, ymd } from '@/lib/format';
import { isNative, saveFile } from '@/lib/native';
import { useUI } from '@/stores/ui';
import { BackLink } from '@/components/BackLink';
import { Button, Confirm, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { Toggle } from './Accounts';

type Range = 'all' | 'year' | 'month';
const TYPE: Record<string, string> = { expense: '支出', income: '收入', transfer: '轉帳' };
const SAMPLE = '﻿日期,類型,金額,帳戶,轉入帳戶,類別,子類別,備註,標籤\r\n2026-11-01 08:30,支出,65,現金,,餐飲,早餐,蛋餅豆漿,#日常\r\n2026-11-05,收入,52000,銀行帳戶,,薪資,,11月薪資,\r\n2026-11-06,轉帳,3000,銀行帳戶,現金,,,提款,\r\n';

export function DataPage() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [range, setRange] = useState<Range>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipDup, setSkipDup] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePw, setRestorePw] = useState('');
  const [backupPw, setBackupPw] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const rangeQs = () => {
    const now = new Date();
    if (range === 'year') return { from: ymd(startOfYear(now)), to: ymd(addYears(startOfYear(now), 1)) };
    if (range === 'month') return { from: ymd(startOfMonth(now)), to: ymd(addMonths(startOfMonth(now), 1)) };
    return {};
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const onImportFile = (f?: File) =>
    f &&
    run('preview', async () => {
      if (f.size > 10 * 1024 * 1024) throw new Error('檔案不可超過 10MB');
      setPreview(await api.upload<ImportPreview>('/import/preview', f, f.name));
    });

  const commit = () =>
    run('commit', async () => {
      const rows = preview!.rows.filter((r) => !r.error);
      const res = await api.post<{ created: number; skipped: number }>('/import/commit', { rows, skipDuplicates: skipDup });
      await qc.invalidateQueries();
      setPreview(null);
      toast({ message: `已匯入 ${res.created} 筆${res.skipped ? `，略過重複 ${res.skipped} 筆` : ''}` });
    });

  const doRestore = () =>
    run('restore', async () => {
      const text = await restoreFile!.text();
      if (isEncrypted(text) && !restorePw) throw new Error('此備份已加密，請輸入備份密碼');
      const counts = await api.post<Record<string, number>>('/backup/restore', { text, password: restorePw || undefined });
      setRestoreFile(null);
      setRestorePw('');
      await qc.invalidateQueries();
      toast({ message: `還原完成：${counts.transactions ?? 0} 筆紀錄、${counts.accounts ?? 0} 個帳戶`, duration: 5000 });
    });

  const doBackup = () =>
    run('backup', async () => {
      if (backupPw && backupPw.length < 6) throw new Error('備份密碼至少 6 碼');
      await api.download(`/backup${photos ? '' : '?photos=0'}`, 'backup', { password: backupPw || undefined });
    });

  const valid = preview?.rows.filter((r) => !r.error) ?? [];
  const invalid = preview?.rows.filter((r) => r.error) ?? [];

  return (
    <div className="space-y-5">
      <BackLink to="/settings" label="更多" />
      <PageHeader title="資料管理" />

      {/* Export */}
      <Card icon={<Download className="size-5" />} title="匯出明細" hint="CSV 可用 Excel / Numbers / Google 試算表開啟；Excel 檔含格式與篩選">
        <Segmented
          layoutId="exp-range"
          size="sm"
          value={range}
          onChange={setRange}
          options={[
            { value: 'all', label: '全部' },
            { value: 'year', label: '今年' },
            { value: 'month', label: '本月' },
          ]}
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="outline" loading={busy === 'csv'} onClick={() => run('csv', () => api.download(`/export/transactions${qs({ format: 'csv', ...rangeQs() })}`, 'ledger.csv'))}>
            <FileText className="size-4" /> CSV
          </Button>
          <Button variant="outline" loading={busy === 'xlsx'} onClick={() => run('xlsx', () => api.download(`/export/transactions${qs({ format: 'xlsx', ...rangeQs() })}`, 'ledger.xlsx'))}>
            <FileSpreadsheet className="size-4" /> Excel
          </Button>
        </div>
      </Card>

      {/* Import */}
      <Card icon={<Upload className="size-5" />} title="匯入明細" hint="支援 CSV 或 Excel（.xlsx）。第一列為標題，至少需有「日期」與「金額」；可直接匯入本 App 匯出的檔案">
        <input ref={importRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { onImportFile(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="grid grid-cols-2 gap-3">
          <Button loading={busy === 'preview'} onClick={() => importRef.current?.click()}>
            <Upload className="size-4" /> 選擇檔案
          </Button>
          <Button
            variant="ghost"
            onClick={() => saveFile('匯入範本.csv', new Blob([SAMPLE], { type: 'text/csv' }))}
          >
            下載範本
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          欄位：日期、類型（支出/收入/轉帳）、金額、帳戶、轉入帳戶、類別、子類別、備註、標籤。找不到的帳戶、類別、標籤會自動建立。
        </p>
      </Card>

      {/* Backup */}
      <Card icon={<DatabaseBackup className="size-5" />} title="完整備份與還原" hint="包含帳戶、類別、所有紀錄、預算、定期交易、模板、目標、匯率與收據照片">
        <label className="mb-3 flex items-center justify-between rounded-2xl bg-surface-2/60 px-4 py-2.5">
          <span className="text-sm">備份包含收據照片</span>
          <Toggle on={photos} onChange={setPhotos} />
        </label>
        <Field label="備份密碼（建議設定，至少 6 碼；留空則為未加密檔）">
          <Input type="password" value={backupPw} onChange={(e) => setBackupPw(e.target.value)} autoComplete="new-password" placeholder="設定後還原時需要輸入" />
        </Field>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="soft" loading={busy === 'backup'} onClick={doBackup}>
            <Download className="size-4" /> {isNative ? '匯出備份' : '下載備份'}
          </Button>
          <input ref={restoreRef} type="file" accept=".json,.diandi,application/json,application/octet-stream" className="hidden" onChange={(e) => { setRestoreFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <Button variant="outline" onClick={() => restoreRef.current?.click()}>
            <ArchiveRestore className="size-4" /> 從備份還原
          </Button>
        </div>
      </Card>

      {/* Import preview */}
      <Sheet
        open={!!preview}
        onClose={() => setPreview(null)}
        title="確認匯入"
        wide
        footer={
          <div className="flex items-center gap-3">
            <label className="flex flex-1 items-center gap-2 text-sm">
              <Toggle on={skipDup} onChange={setSkipDup} /> 略過重複紀錄
            </label>
            <Button className="h-12 px-6" disabled={!valid.length} loading={busy === 'commit'} onClick={commit}>
              匯入 {valid.length} 筆
            </Button>
          </div>
        }
      >
        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="可匯入" value={valid.length} />
              <Stat label="有問題" value={invalid.length} warn={invalid.length > 0} />
              <Stat label="新項目" value={preview.newAccounts.length + preview.newCategories.length + preview.newTags.length} />
            </div>
            {(preview.newAccounts.length > 0 || preview.newCategories.length > 0 || preview.newTags.length > 0) && (
              <div className="space-y-1.5 rounded-2xl bg-surface-2/60 p-3 text-sm">
                <p className="font-semibold">將自動建立</p>
                {preview.newAccounts.length > 0 && <p className="text-muted">帳戶：{preview.newAccounts.join('、')}</p>}
                {preview.newCategories.length > 0 && <p className="text-muted">類別：{preview.newCategories.join('、')}</p>}
                {preview.newTags.length > 0 && <p className="text-muted">標籤：{preview.newTags.map((t) => `#${t}`).join(' ')}</p>}
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface-2/60 text-xs text-muted">
                  <tr>
                    {['列', '日期', '類型', '金額', '帳戶', '類別', '備註'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.slice(0, 200).map((r) => (
                    <tr key={r.line} className={cn(r.error && 'bg-expense/5')}>
                      <td className="px-3 py-2 text-muted">{r.line}</td>
                      <td className="num whitespace-nowrap px-3 py-2">{r.occurredAt ? r.occurredAt.replace('T', ' ') : '—'}</td>
                      <td className="px-3 py-2">{TYPE[r.type]}</td>
                      <td className="num px-3 py-2 font-semibold">{money(r.amount)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{r.account}{r.toAccount && ` → ${r.toAccount}`}</td>
                      <td className="whitespace-nowrap px-3 py-2">{[r.category, r.subcategory].filter(Boolean).join(' › ') || '—'}</td>
                      <td className="px-3 py-2">
                        {r.error ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-expense"><AlertTriangle className="size-3.5" />{r.error}</span>
                        ) : (
                          <span className="line-clamp-1 text-muted">{r.note}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 200 && <p className="text-center text-xs text-muted">僅顯示前 200 列，共 {preview.rows.length} 列</p>}
          </div>
        )}
      </Sheet>

      <Confirm
        open={!!restoreFile}
        onClose={() => setRestoreFile(null)}
        title="從備份還原？"
        message={
          <>
            將以「{restoreFile?.name}」<b className="text-expense">取代你目前的所有資料</b>（帳戶、紀錄、預算、照片等），此動作無法復原。建議先匯出一份目前的備份。
            <span className="mt-3 block">
              <Input type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} placeholder="備份密碼（加密備份才需要）" autoComplete="off" />
            </span>
          </>
        }
        confirmText="確定還原"
        loading={busy === 'restore'}
        onConfirm={doRestore}
      />
    </div>
  );
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
      <div className="mb-4 flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</span>
        <div>
          <h2 className="font-bold">{title}</h2>
          <p className="text-xs leading-relaxed text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </motion.section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <AnimatePresence>
      <div className={cn('rounded-2xl p-3', warn ? 'bg-expense/10' : 'bg-surface-2/60')}>
        <p className={cn('num text-xl font-extrabold', warn && 'text-expense')}>{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </AnimatePresence>
  );
}
