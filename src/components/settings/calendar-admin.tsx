"use client";
import { CalendarPlus, FileUp, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  addOverrideAction,
  applyCalendarImportAction,
  applyRecalculationAction,
  previewCalendarImportAction,
  previewOverrideAction,
  removeOverrideAction,
} from "@/app/actions/settings";
import { ScheduleDiffTable } from "@/components/common/schedule-diff-table";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatROCShort } from "@/lib/dates";
import type { ScheduleChange } from "@/server/schedule/schedule-calculator";

type CaseDiff = { caseId: string; schoolName: string; projectCode: string; changes: ScheduleChange[] };

export function CaseDiffList({ diffs }: { diffs: CaseDiff[] }) {
  if (!diffs.length) return <p className="text-sm text-muted-foreground">所有進行中案件之期限皆無差異。</p>;
  return (
    <div className="space-y-3">
      {diffs.map((d) => (
        <div key={d.caseId} className="rounded-md border">
          <p className="border-b bg-slate-50 px-3 py-1.5 text-sm font-medium">
            {d.schoolName} <span className="font-mono text-xs text-muted-foreground">{d.projectCode}</span>
          </p>
          <ScheduleDiffTable changes={d.changes} />
        </div>
      ))}
    </div>
  );
}

/** 政府開放資料的 CSV 可能是 UTF-8 或 Big5 編碼，先試 UTF-8，失敗再用 Big5 */
function decodeCalendarFile(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("big5").decode(buf);
  }
}

export function CalendarImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [declared, setDeclared] = useState(false);
  const [source, setSource] = useState("行政院人事行政總處 政府行政機關辦公日曆表");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ parsed: { years: { year: number; days: { date: string; kind: string; description: string | null }[]; isComplete: boolean; coveredDays: number }[]; warnings: string[]; format: string }; diffs: CaseDiff[] } | null>(null);
  const { run, pending } = useAction();

  const onFile = async (f: File | undefined) => {
    setPreview(null);
    if (!f) return setFile(null);
    if (f.size > 2_000_000) return alert("檔案過大（上限 2MB）");
    setFile({ name: f.name, text: decodeCalendarFile(await f.arrayBuffer()) });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cal-file">日曆檔案（CSV 或 JSON）</Label>
          <Input id="cal-file" type="file" accept=".csv,.json,.txt,text/csv,application/json" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cal-source">資料來源</Label>
          <Input id="cal-source" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
        <span>
          此為官方公告之完整年度日曆（僅列例外日之簡易格式需勾選；官方逐日 CSV 會自動判斷）
        </span>
      </label>
      <Button variant="outline" disabled={!file || pending} onClick={() => file && run(() => previewCalendarImportAction(file.name, file.text, declared), { refresh: false, onSuccess: (d) => d && setPreview(d) })}>
        {pending ? <Loader2 className="animate-spin" /> : <FileUp />}
        解析並預覽差異
      </Button>

      {preview && (
        <div className="space-y-4 rounded-md border bg-slate-50 p-3">
          <div>
            <p className="text-sm font-semibold">解析結果</p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {preview.parsed.years.map((y) => (
                <li key={y.year}>
                  {y.year} 年（民國 {y.year - 1911} 年）：放假日 {y.days.filter((d) => d.kind === "HOLIDAY").length} 筆、補行上班 {y.days.filter((d) => d.kind === "MAKEUP_WORKDAY").length} 筆，
                  {y.isComplete ? <span className="text-emerald-700">完整日曆</span> : <span className="text-amber-700">非完整日曆（期限將標示暫估）</span>}
                </li>
              ))}
            </ul>
            {preview.parsed.warnings.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-amber-800">
                {preview.parsed.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-primary">檢視匯入之日期</summary>
              <ul className="mt-1 max-h-60 overflow-y-auto">
                {preview.parsed.years.flatMap((y) => y.days).map((d) => (
                  <li key={d.date}>
                    {formatROCShort(d.date)} {d.kind === "HOLIDAY" ? "放假" : "補行上班"} {d.description}
                  </li>
                ))}
              </ul>
            </details>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">匯入後期限差異預覽</p>
            <CaseDiffList diffs={preview.diffs} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-reason">匯入原因（必填）</Label>
            <Input id="cal-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：人事總處公告 116 年辦公日曆" />
          </div>
          <Button
            disabled={pending || !reason.trim() || !file}
            onClick={() =>
              file &&
              run(() => applyCalendarImportAction({ fileName: file.name, text: file.text, declaredComplete: declared, source, reason }), {
                onSuccess: () => {
                  setPreview(null);
                  setFile(null);
                  router.push("/settings/recalculate");
                },
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />}
            確認匯入
          </Button>
        </div>
      )}
    </div>
  );
}

type OverrideKind = "HOLIDAY" | "MAKEUP_WORKDAY";

/** 新增休假日（例如颱風假）或補行上班日：先預覽期限變化，確認後自動往後（或往前）調整所有進行中案件 */
export function OverrideForm({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const [v, setV] = useState({ date: "", kind: "HOLIDAY" as OverrideKind, reason: "" });
  const [diffs, setDiffs] = useState<CaseDiff[] | null>(null);
  const { run, pending } = useAction();
  const set = (patch: Partial<typeof v>) => {
    setV((s) => ({ ...s, ...patch }));
    setDiffs(null);
  };
  const taskCount = diffs?.reduce((n, d) => n + d.changes.filter((c) => c.action !== "SKIP_LOCKED").length, 0) ?? 0;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => previewOverrideAction(v), { refresh: false, onSuccess: (d) => d && setDiffs(d) });
      }}
    >
      <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-[160px_180px_1fr_auto] md:items-end"}>
        <div className="space-y-1.5">
          <Label htmlFor="ov-date">日期</Label>
          <Input id="ov-date" type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ov-kind">類型</Label>
          <Select id="ov-kind" value={v.kind} onChange={(e) => set({ kind: e.target.value as OverrideKind })}>
            <option value="HOLIDAY">放假日（例如颱風假）</option>
            <option value="MAKEUP_WORKDAY">補行上班日</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ov-reason">原因（必填）</Label>
          <Input id="ov-reason" value={v.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="例如：颱風停止上班（北市府公告）" required />
        </div>
        {!diffs && (
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarPlus />}
            預覽期限變更
          </Button>
        )}
      </div>
      {diffs && (
        <div className="space-y-3 rounded-md border bg-slate-50 p-3">
          <p className="text-sm font-semibold">
            {diffs.length ? `將調整 ${diffs.length} 所學校、${taskCount} 項工作的期限（已完成及人工鎖定的工作不變）` : "此日期不影響任何進行中工作的期限"}
          </p>
          {diffs.length > 0 && (
            <div className="max-h-80 overflow-y-auto">
              <CaseDiffList diffs={diffs} />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => addOverrideAction(v), {
                  onSuccess: (r) => {
                    toast.success(r && r.updated + r.created ? `已更新 ${r.updated + r.created} 項工作的期限` : "已新增，期限無需變更");
                    setV({ date: "", kind: "HOLIDAY", reason: "" });
                    setDiffs(null);
                    onDone?.();
                  },
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              確認新增並更新期限
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDiffs(null)}>
              返回修改
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** 行事曆頁的「新增放假日」按鈕（管理員） */
export function AddHolidayButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus />
          新增放假日
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新增放假日（颱風假等）</DialogTitle>
          <DialogDescription>新增後，所有進行中案件的期限會自動跳過這一天往後順延；已完成及人工鎖定的工作不會變動。</DialogDescription>
        </DialogHeader>
        <OverrideForm compact onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function RemoveOverrideButton({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="xs" className="text-red-700">
          <Trash2 />
          刪除
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>刪除工作天調整</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`rm-${id}`}>刪除原因（必填）</Label>
          <Input id={`rm-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => run(() => removeOverrideAction(id, reason), { onSuccess: () => setOpen(false) })}>
            {pending && <Loader2 className="animate-spin" />}
            刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApplyRecalculationForm({ count }: { count: number }) {
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="rc-reason">重新計算原因（必填）</Label>
        <Input id="rc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：匯入 116 年辦公日曆" />
      </div>
      <Button disabled={pending || !reason.trim() || count === 0} onClick={() => run(() => applyRecalculationAction(reason), { onSuccess: () => setReason("") })}>
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        套用期限變更（{count} 個案件）
      </Button>
    </div>
  );
}
