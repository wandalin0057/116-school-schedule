"use client";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { resendDigestAction, type ResendResult } from "@/app/actions/settings";
import { CopyButton } from "@/components/common/copy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ResendDigestButton({ userId, name, to, disabled }: { userId: string; name: string; to: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState<Extract<ResendResult, { mode: "manual" }> | null>(null);

  const send = async () => {
    setPending(true);
    const r = await resendDigestAction(userId);
    setPending(false);
    if (!r.ok) return void toast.error(r.message);
    const d = r.data!;
    if (d.mode === "manual") return setManual(d);
    setOpen(false);
    if (d.mode === "sent") toast.success(`已補寄給 ${d.to}`);
    else toast.success(`已請 GitHub 補寄給 ${d.email}，約 1～2 分鐘後送達`, { duration: 8000 });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setManual(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Send />
          補寄這封信
        </Button>
      </DialogTrigger>
      <DialogContent>
        {!manual ? (
          <>
            <DialogHeader>
              <DialogTitle>補寄提醒信給 {name}？</DialogTitle>
              <DialogDescription>會立即寄出上面預覽的這封信到 {to}。不影響明天早上 8:30 的每日提醒。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button disabled={pending} onClick={() => void send()}>
                {pending ? <Loader2 className="animate-spin" /> : <Send />}
                確認補寄
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>請到 GitHub 補寄（約 1 分鐘）</DialogTitle>
              <DialogDescription>網站本身無法寄信，補寄由 GitHub 以 Gmail 寄出。</DialogDescription>
            </DialogHeader>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                {manual.actionsUrl ? (
                  <a href={manual.actionsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 underline">
                    開啟 GitHub「每日提醒」頁面 <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  "到 GitHub 儲存庫 → Actions → 左側「每日提醒」"
                )}
              </li>
              <li>按右側「Run workflow」。</li>
              <li>
                在「補寄」欄位貼上這個 Email：
                <div className="mt-1 flex items-center gap-2">
                  <code className="rounded bg-slate-100 px-2 py-1">{manual.email}</code>
                  <CopyButton text={manual.email} label="複製" />
                </div>
              </li>
              <li>按綠色「Run workflow」，約 1 分鐘後寄出。</li>
            </ol>
            <p className="text-xs text-muted-foreground">想要按一下就自動補寄：請管理員在 Render 設定 GITHUB_DISPATCH_TOKEN（見操作手冊）。</p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
