"use client";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createVideoAction, deleteVideoAction, updateVideoAction } from "@/app/actions/videos";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TAIPEI_DISTRICTS } from "@/server/cases/case-schema";
import { CARD_SOURCES, STANDALONE_KINDS, type CardSource, type StandaloneKind } from "@/server/videos/standalone-kinds";

export type VideoFormValues = {
  projectName: string;
  schoolName: string;
  district: string;
  responsibleUserId: string;
  noticeDate: string;
  approvedDate: string;
  cardSource: CardSource;
  notes: string;
};
type UserOption = { id: string; name: string; email: string };
/** 新增本案規劃之圖卡時，可由學校案件帶入資料 */
export type SchoolOption = { id: string; projectName: string; schoolName: string; district: string; responsibleUserId: string; approvedDate: string };

export function VideoDialog({
  kind = "RESULT_VIDEO",
  users,
  projects,
  schools = [],
  video,
}: {
  kind?: StandaloneKind;
  users: UserOption[];
  projects: string[];
  schools?: SchoolOption[];
  video?: { id: string } & VideoFormValues;
}) {
  const k = STANDALONE_KINDS[kind];
  const cards = kind === "BEFORE_AFTER_CARDS";
  const empty: VideoFormValues = { projectName: projects[0] ?? "", schoolName: "", district: "", responsibleUserId: "", noticeDate: "", approvedDate: "", cardSource: "PLANNED", notes: "" };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<VideoFormValues>(video ?? empty);
  const { run, pending } = useAction();
  const set = (k: keyof VideoFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const id = video?.id ?? "new";
  const noticeLabel = cards ? CARD_SOURCES[v.cardSource].dateLabel : "機關通知日";
  const noticeHint =
    kind === "RESULT_VIDEO"
      ? "通知次日起 20 個工作天內提供 3 分鐘成果影片；尚未通知可先留空。"
      : cards
        ? `${v.cardSource === "PLANNED" ? "同意備查之日" : "通知"}次日起 15 個工作天內提供局部通學區改善前後對照圖卡及全區重點改善工項宣傳圖。`
        : "通知次日起 18 個工作天內提供；尚未通知可先留空。";
  const pickSchool = (schoolId: string) => {
    const s = schools.find((x) => x.id === schoolId);
    if (s) setV((cur) => ({ ...cur, projectName: s.projectName, schoolName: s.schoolName, district: s.district, responsibleUserId: s.responsibleUserId, noticeDate: s.approvedDate || cur.noticeDate }));
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(video ?? empty);
      }}
    >
      <DialogTrigger asChild>
        {video ? (
          <Button variant="ghost" size="xs">
            <Pencil />
            編輯
          </Button>
        ) : (
          <Button>
            <Plus />
            新增{k.label}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{video ? `編輯${k.label}` : `新增${k.label}`}</DialogTitle>
          <DialogDescription>{k.label}獨立於學校案件。填寫{noticeLabel}後，系統自動推算繳交期限與前一個工作天的創稿（只提醒您）。</DialogDescription>
        </DialogHeader>
        <form
          id={`video-form-${id}`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => (video ? updateVideoAction(video.id, v, kind) : createVideoAction(v, kind)), { onSuccess: () => setOpen(false) });
          }}
        >
          {cards && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`vd-source-${id}`}>來源</Label>
                <Select id={`vd-source-${id}`} value={v.cardSource} onChange={set("cardSource")}>
                  {(Object.keys(CARD_SOURCES) as CardSource[]).map((s) => (
                    <option key={s} value={s}>
                      {CARD_SOURCES[s].label}
                    </option>
                  ))}
                </Select>
              </div>
              {!video && v.cardSource === "PLANNED" && schools.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`vd-pick-${id}`}>由學校案件帶入</Label>
                  <Select id={`vd-pick-${id}`} defaultValue="" onChange={(e) => pickSchool(e.target.value)}>
                    <option value="">（選擇學校）</option>
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.schoolName}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`vd-project-${id}`}>計畫名稱</Label>
            <Select id={`vd-project-${id}`} value={v.projectName} onChange={set("projectName")}>
              {[...new Set([...projects, v.projectName].filter(Boolean))].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`vd-school-${id}`}>學校名稱</Label>
            <Input id={`vd-school-${id}`} value={v.schoolName} onChange={set("schoolName")} required={k.schoolRequired} placeholder={k.schoolHint} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`vd-district-${id}`}>行政區</Label>
              <Select id={`vd-district-${id}`} value={v.district} onChange={set("district")}>
                <option value="">（未填）</option>
                {TAIPEI_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`vd-notice-${id}`}>{noticeLabel}</Label>
            <Input id={`vd-notice-${id}`} type="date" value={v.noticeDate} onChange={set("noticeDate")} />
            <p className="text-xs text-muted-foreground">{noticeHint}</p>
          </div>
          {kind === "RESULT_VIDEO" && (
            <div className="space-y-1.5">
              <Label htmlFor={`vd-approved-${id}`}>機關審核同意通知日（15 秒版本）</Label>
              <Input id={`vd-approved-${id}`} type="date" value={v.approvedDate} onChange={set("approvedDate")} />
              <p className="text-xs text-muted-foreground">3 分鐘影片經機關審核同意後填寫；通知次日起 10 個工作天內提供 15 秒版本。</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`vd-user-${id}`}>負責人</Label>
            <Select id={`vd-user-${id}`} value={v.responsibleUserId} onChange={set("responsibleUserId")} required>
              <option value="">請選擇</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}（{u.email}）
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`vd-notes-${id}`}>備註</Label>
            <Textarea id={`vd-notes-${id}`} rows={3} value={v.notes} onChange={set("notes")} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button type="submit" form={`video-form-${id}`} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteVideoButton({ id, label, kind = "RESULT_VIDEO" }: { id: string; label: string; kind?: StandaloneKind }) {
  const k = STANDALONE_KINDS[kind];
  const [open, setOpen] = useState(false);
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
          <DialogTitle>刪除{k.label}</DialogTitle>
          <DialogDescription>確定刪除「{label}」？此項目的工作、提醒與公文會一併刪除，無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteVideoAction(id, kind), { onSuccess: () => setOpen(false) })}>
            {pending && <Loader2 className="animate-spin" />}
            刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
