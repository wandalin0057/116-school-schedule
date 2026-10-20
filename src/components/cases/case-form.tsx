"use client";
import { Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { createCaseAction, previewCaseUpdateAction, updateCaseAction } from "@/app/actions/cases";
import { ScheduleDiffTable } from "@/components/common/schedule-diff-table";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CaseInput } from "@/server/cases/case-schema";
import { CASE_STATUS_LABELS, TAIPEI_DISTRICTS } from "@/server/cases/case-schema";
import type { ScheduleChange } from "@/server/schedule/schedule-calculator";

const OTHER_PROJECT = "__other__";

type FormValues = Required<{ [K in keyof CaseInput]: string }>;

function Field({ label, name, error, children, hint, required }: { label: string; name: string; error?: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CaseForm({
  mode,
  caseId,
  initial,
  users,
  projectNames,
  canCreateResponsible = false,
}: {
  mode: "create" | "edit";
  caseId?: string;
  initial: FormValues;
  users: { id: string; name: string; email: string }[];
  projectNames: string[];
  canCreateResponsible?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ScheduleChange[] | null>(null);
  const { run, pending } = useAction();
  const projectOptions = projectNames.includes(initial.projectName) || !initial.projectName ? projectNames : [initial.projectName, ...projectNames];
  const [customProject, setCustomProject] = useState(false);
  const emailTrim = v.responsibleEmail.trim().toLowerCase();
  const responsibleMatch = users.find((u) => u.email.toLowerCase() === emailTrim);
  const responsibleIsNew = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailTrim) && !responsibleMatch;
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const datesChanged =
    v.notificationDate !== initial.notificationDate ||
    v.reviewMeetingDateTime !== initial.reviewMeetingDateTime ||
    v.siteVisitDateTime !== initial.siteVisitDateTime ||
    v.finalReportNoticeDate !== initial.finalReportNoticeDate ||
    v.finalReportApprovedDate !== initial.finalReportApprovedDate;

  const handleErrors = (res: { ok: boolean; fieldErrors?: Record<string, string[] | undefined> }) => {
    if (!res.ok && res.fieldErrors) {
      setErrors(Object.fromEntries(Object.entries(res.fieldErrors).map(([k, val]) => [k, val?.[0] ?? ""])));
    }
  };

  const submit = async () => {
    setErrors({});
    if (mode === "create") {
      const res = await run(() => createCaseAction(v as CaseInput), { refresh: false, onSuccess: (d) => d && router.push(`/cases/${d.id}`) });
      handleErrors(res);
      return;
    }
    if (datesChanged) {
      const res = await run(() => previewCaseUpdateAction(caseId!, v as CaseInput), { refresh: false });
      handleErrors(res);
      if (res.ok) setPreview(res.data ?? []);
      return;
    }
    await save();
  };

  const save = async () => {
    const res = await run(() => updateCaseAction(caseId!, v as CaseInput), {
      refresh: false,
      onSuccess: (d) => {
        if (d && (d.updated || d.created)) toast.info(`期限已更新 ${d.updated} 項、新建工作 ${d.created} 項`);
        router.push(`/cases/${caseId}`);
        router.refresh();
      },
    });
    handleErrors(res);
    if (res.ok) setPreview(null);
  };

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>基本資料</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="案件編號" name="projectCode" error={errors.projectCode} required hint="不可重複，例如 TP115-001">
            <Input id="projectCode" value={v.projectCode} onChange={set("projectCode")} required />
          </Field>
          <Field label="計畫名稱" name="projectName" error={errors.projectName} required hint={customProject ? "輸入新的計畫名稱，儲存後會自動加入計畫清單" : undefined}>
            <Select
              id="projectName"
              value={customProject ? OTHER_PROJECT : v.projectName}
              onChange={(e) => {
                if (e.target.value === OTHER_PROJECT) {
                  setCustomProject(true);
                  setV((s) => ({ ...s, projectName: "" }));
                } else {
                  setCustomProject(false);
                  setV((s) => ({ ...s, projectName: e.target.value }));
                }
              }}
            >
              {projectOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={OTHER_PROJECT}>＋ 其他計畫（自行輸入）</option>
            </Select>
            {customProject && (
              <Input
                id="projectNameCustom"
                className="mt-2"
                value={v.projectName}
                onChange={set("projectName")}
                placeholder="例如：117年度臺北市通學區規劃分析案"
                autoFocus
                required
              />
            )}
          </Field>
          <Field label="學校名稱" name="schoolName" error={errors.schoolName} required>
            <Input id="schoolName" value={v.schoolName} onChange={set("schoolName")} required />
          </Field>
          <Field label="行政區" name="district" error={errors.district}>
            <Input id="district" list="districts" value={v.district} onChange={set("district")} />
            <datalist id="districts">
              {TAIPEI_DISTRICTS.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="負責人姓名" name="responsibleName" error={errors.responsibleName} required hint="可直接輸入，或從清單選擇既有同事">
            <Input
              id="responsibleName"
              list="responsible-names"
              value={v.responsibleName}
              onChange={(e) => {
                const name = e.target.value;
                const match = users.find((u) => u.name === name);
                setV((s) => ({ ...s, responsibleName: name, responsibleEmail: match ? match.email : s.responsibleEmail }));
              }}
              placeholder="例如：陳工程師"
              required
            />
            <datalist id="responsible-names">
              {users.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.email}
                </option>
              ))}
            </datalist>
          </Field>
          <Field
            label="負責人 Email（提醒信寄送對象）"
            name="responsibleEmail"
            error={errors.responsibleEmail}
            required
            hint={
              responsibleIsNew
                ? canCreateResponsible
                  ? "此 Email 尚無帳號：儲存時會自動建立「僅收提醒」的帳號"
                  : "此 Email 尚無帳號，請洽管理員新增"
                : responsibleMatch
                  ? `既有同事：${responsibleMatch.name}`
                  : undefined
            }
          >
            <Input
              id="responsibleEmail"
              type="email"
              list="responsible-emails"
              value={v.responsibleEmail}
              onChange={(e) => {
                const email = e.target.value;
                const match = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
                setV((s) => ({ ...s, responsibleEmail: email, responsibleName: match && !s.responsibleName ? match.name : s.responsibleName }));
              }}
              placeholder="name@example.com"
              required
            />
            <datalist id="responsible-emails">
              {users.map((u) => (
                <option key={u.id} value={u.email}>
                  {u.name}
                </option>
              ))}
            </datalist>
          </Field>
          <Field label="案件狀態" name="status" error={errors.status}>
            <Select id="status" value={v.status} onChange={set("status")}>
              {Object.entries(CASE_STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>機關資訊</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="機關名稱" name="agencyName" error={errors.agencyName}>
            <Input id="agencyName" value={v.agencyName} onChange={set("agencyName")} placeholder="臺北市政府交通局" />
          </Field>
          <Field label="機關承辦人" name="agencyContact" error={errors.agencyContact}>
            <Input id="agencyContact" value={v.agencyContact} onChange={set("agencyContact")} />
          </Field>
          <Field label="承辦人 Email" name="agencyEmail" error={errors.agencyEmail} hint="多筆以逗號分隔">
            <Input id="agencyEmail" value={v.agencyEmail} onChange={set("agencyEmail")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>期程日期</CardTitle>
          <p className="text-sm text-muted-foreground">日期可分次填寫；每次儲存時系統會重新計算尚未完成且未人工鎖定之工作期限（Asia/Taipei，依官方辦公日曆）。</p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="機關通知日（D0）" name="notificationDate" error={errors.notificationDate}>
            <Input id="notificationDate" type="date" value={v.notificationDate} onChange={set("notificationDate")} />
          </Field>
          <Field label="機關第幾次通知" name="notificationRound" error={errors.notificationRound} hint="Email 內文會顯示「第11次通知」">
            <Input id="notificationRound" inputMode="numeric" value={v.notificationRound} onChange={set("notificationRound")} placeholder="例如：11" />
          </Field>
          <Field label="審查會議日期時間" name="reviewMeetingDateTime" error={errors.reviewMeetingDateTime}>
            <Input id="reviewMeetingDateTime" type="datetime-local" value={v.reviewMeetingDateTime} onChange={set("reviewMeetingDateTime")} />
          </Field>
          <Field label="審查會議地點" name="reviewMeetingLocation" error={errors.reviewMeetingLocation}>
            <Input id="reviewMeetingLocation" value={v.reviewMeetingLocation} onChange={set("reviewMeetingLocation")} />
          </Field>
          <Field label="會勘日期時間" name="siteVisitDateTime" error={errors.siteVisitDateTime}>
            <Input id="siteVisitDateTime" type="datetime-local" value={v.siteVisitDateTime} onChange={set("siteVisitDateTime")} />
          </Field>
          <Field label="會勘地點" name="siteVisitLocation" error={errors.siteVisitLocation}>
            <Input id="siteVisitLocation" value={v.siteVisitLocation} onChange={set("siteVisitLocation")} />
          </Field>
          <Field label="會勘簡報上傳網址" name="siteVisitUploadUrl" error={errors.siteVisitUploadUrl} hint="承辦提供之上傳連結">
            <Input id="siteVisitUploadUrl" type="url" value={v.siteVisitUploadUrl} onChange={set("siteVisitUploadUrl")} placeholder="https://" />
          </Field>
          <Field
            label="機關通知提送完整報告書日"
            name="finalReportNoticeDate"
            error={errors.finalReportNoticeDate}
            hint="提供會勘後修正圖說後，機關通知之日；次日起 5 個工作天內提送完整之規劃及分析報告書"
          >
            <Input id="finalReportNoticeDate" type="date" value={v.finalReportNoticeDate} onChange={set("finalReportNoticeDate")} />
          </Field>
          <Field
            label="機關同意備查日"
            name="finalReportApprovedDate"
            error={errors.finalReportApprovedDate}
            hint="收到機關同意備查完整報告書之日；起 15 個工作天內提供改善前後對照圖卡"
          >
            <Input id="finalReportApprovedDate" type="date" value={v.finalReportApprovedDate} onChange={set("finalReportApprovedDate")} />
          </Field>
          {mode === "edit" && datesChanged && (
            <Field label="日期異動原因" name="dateChangeReason" error={errors.dateChangeReason} hint="將記錄於異動歷史">
              <Input id="dateChangeReason" value={v.dateChangeReason} onChange={set("dateChangeReason")} placeholder="例如：機關來函改期" />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>備註</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea id="notes" value={v.notes} onChange={set("notes")} rows={4} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          {mode === "create" ? "建立案件" : datesChanged ? "預覽期限變更" : "儲存"}
        </Button>
      </div>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>確認期限變更</DialogTitle>
            <DialogDescription>以下為日期變更後之工作期限差異。已完成之工作保留原紀錄；人工鎖定之期限不變更。</DialogDescription>
          </DialogHeader>
          {preview && <ScheduleDiffTable changes={preview} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
              返回修改
            </Button>
            <Button onClick={() => void save()} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              確認儲存並更新期限
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
