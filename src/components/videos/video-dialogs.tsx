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

export type VideoFormValues = { projectName: string; schoolName: string; district: string; responsibleUserId: string; dueDate: string; notes: string };
type UserOption = { id: string; name: string; email: string };

export function VideoDialog({ users, projects, video }: { users: UserOption[]; projects: string[]; video?: { id: string } & VideoFormValues }) {
  const empty: VideoFormValues = { projectName: projects[0] ?? "", schoolName: "", district: "", responsibleUserId: "", dueDate: "", notes: "" };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<VideoFormValues>(video ?? empty);
  const { run, pending } = useAction();
  const set = (k: keyof VideoFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const id = video?.id ?? "new";
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
            新增成果影片
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{video ? "編輯成果影片" : "新增成果影片"}</DialogTitle>
          <DialogDescription>成果影片獨立於學校案件。期限前一個工作天會建立「成果影片創稿」（發文，只提醒您）；期限前會寄每日提醒給負責人。</DialogDescription>
        </DialogHeader>
        <form
          id={`video-form-${id}`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => (video ? updateVideoAction(video.id, v) : createVideoAction(v)), { onSuccess: () => setOpen(false) });
          }}
        >
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
            <Input id={`vd-school-${id}`} value={v.schoolName} onChange={set("schoolName")} required placeholder="例如：臺北市大安區仁愛國民小學" />
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
            <div className="space-y-1.5">
              <Label htmlFor={`vd-due-${id}`}>期限</Label>
              <Input id={`vd-due-${id}`} type="date" value={v.dueDate} onChange={set("dueDate")} required />
            </div>
          </div>
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

export function DeleteVideoButton({ id, label }: { id: string; label: string }) {
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
          <DialogTitle>刪除成果影片</DialogTitle>
          <DialogDescription>確定刪除「{label}」？此項目的工作、提醒與成果影片公文會一併刪除，無法復原。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteVideoAction(id), { onSuccess: () => setOpen(false) })}>
            {pending && <Loader2 className="animate-spin" />}
            刪除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
