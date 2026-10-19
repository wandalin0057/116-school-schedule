"use client";
import { Loader2, Save, Send } from "lucide-react";
import { useState } from "react";
import {
  changeOwnPasswordAction,
  sendTestEmailAction,
  updateEmailSettingsAction,
  updateOrganizationAction,
  updateReminderPreferenceAction,
} from "@/app/actions/settings";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { run, pending } = useAction();
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <form
      className="max-w-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => changeOwnPasswordAction(current, next), {
          onSuccess: () => {
            setCurrent("");
            setNext("");
            setConfirm("");
          },
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="cur">目前密碼</Label>
        <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new">新密碼</Label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <p className="text-xs text-muted-foreground">至少 10 個字元，需包含英文字母與數字。</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cf">確認新密碼</Label>
        <Input id="cf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {mismatch && <p className="text-xs text-red-600">兩次輸入不一致</p>}
      </div>
      <Button type="submit" disabled={pending || mismatch || !next}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
        變更密碼
      </Button>
    </form>
  );
}

export function ReminderPreferenceForm({
  initial,
  isAdmin = false,
}: {
  initial: { emailEnabled: boolean; leadBusinessDays: number; overdueEnabled: boolean; dailyDigestEnabled: boolean; managerDigestEnabled: boolean };
  isAdmin?: boolean;
}) {
  const [v, setV] = useState(initial);
  const { run, pending } = useAction();
  const toggle = (k: "emailEnabled" | "overdueEnabled" | "dailyDigestEnabled" | "managerDigestEnabled", label: string, desc: string) => (
    <label className="flex items-start gap-3 rounded-md border p-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4" checked={v[k]} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.checked }))} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{desc}</span>
      </span>
    </label>
  );
  return (
    <form
      className="max-w-lg space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateReminderPreferenceAction(v));
      }}
    >
      {toggle("emailEnabled", "接收 Email 通知", "關閉後不會收到任何系統提醒信")}
      {toggle("dailyDigestEnabled", "接收每日摘要", "每個工作天上午 9:00～9:30 寄送今日到期、即將到期與逾期工作")}
      {isAdmin &&
        toggle(
          "managerDigestEnabled",
          "改收「全部學校總表」（專案經理）",
          "每天收到一封整理所有學校、標示各負責人的總表，取代上面只含自己負責學校的摘要。各負責人仍會收到自己的提醒信。",
        )}
      {toggle("overdueEnabled", "接收逾期通知", "於每日摘要中列出已逾期且未完成之工作")}
      <div className="space-y-1.5">
        <Label htmlFor="lead">提前提醒工作天數</Label>
        <Input id="lead" type="number" min={0} max={20} className="w-32" value={v.leadBusinessDays} onChange={(e) => setV((s) => ({ ...s, leadBusinessDays: Number(e.target.value) }))} />
        <p className="text-xs text-muted-foreground">列出未來 N 個工作天內到期之工作（預設 3）。</p>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
        儲存通知設定
      </Button>
    </form>
  );
}

export function EmailSettingsForm({ initial }: { initial: { testMode: boolean; testRecipient: string; skipNonBusinessDays: boolean } }) {
  const [v, setV] = useState(initial);
  const [testTo, setTestTo] = useState(initial.testRecipient);
  const { run, pending } = useAction();
  return (
    <div className="max-w-lg space-y-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateEmailSettingsAction(v));
        }}
      >
        <label className="flex items-start gap-3 rounded-md border p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={v.testMode} onChange={(e) => setV((s) => ({ ...s, testMode: e.target.checked }))} />
          <span>
            <span className="block text-sm font-medium">測試模式</span>
            <span className="text-xs text-muted-foreground">啟用時所有每日提醒改寄至測試收件人，主旨加註［測試］。正式上線前請先以測試模式驗證。</span>
          </span>
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="testRecipient">測試收件人</Label>
          <Input id="testRecipient" type="email" value={v.testRecipient} onChange={(e) => setV((s) => ({ ...s, testRecipient: e.target.value }))} />
        </div>
        <label className="flex items-start gap-3 rounded-md border p-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={v.skipNonBusinessDays} onChange={(e) => setV((s) => ({ ...s, skipNonBusinessDays: e.target.checked }))} />
          <span>
            <span className="block text-sm font-medium">非工作天不寄送</span>
            <span className="text-xs text-muted-foreground">週末與國定假日不寄送每日提醒（依工作日曆判定）。</span>
          </span>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          儲存 Email 設定
        </Button>
      </form>
      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="testTo">寄送測試信至</Label>
          <Input id="testTo" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        </div>
        <Button variant="outline" disabled={pending} onClick={() => run(() => sendTestEmailAction(testTo), { refresh: false })}>
          <Send />
          寄送測試信
        </Button>
      </div>
    </div>
  );
}

type Org = { companyName: string; address: string; contactName: string; phone: string; fax: string; email: string };

export function OrganizationForm({ initial }: { initial: Org }) {
  const [v, setV] = useState(initial);
  const { run, pending } = useAction();
  const field = (k: keyof Org, label: string, placeholder: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`org-${k}`}>{label}</Label>
      <Input id={`org-${k}`} value={v[k]} placeholder={placeholder} onChange={(e) => setV((s) => ({ ...s, [k]: e.target.value }))} />
    </div>
  );
  return (
    <form
      className="grid max-w-2xl gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateOrganizationAction(v));
      }}
    >
      <div className="sm:col-span-2">{field("companyName", "公司名稱（公文抬頭）", "○○工程顧問股份有限公司")}</div>
      <div className="sm:col-span-2">{field("address", "地址", "110048 臺北市信義區○○路○號○樓")}</div>
      {field("contactName", "聯絡人", "王小明")}
      {field("phone", "電話", "02-2748-8822#6685")}
      {field("fax", "傳真", "02-2748-6600")}
      {field("email", "電子郵件", "name@company.com.tw")}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          儲存發文單位資訊
        </Button>
      </div>
    </form>
  );
}
