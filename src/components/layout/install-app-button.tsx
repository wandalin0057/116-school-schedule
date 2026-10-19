"use client";
import { MonitorDown } from "lucide-react";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Chrome／Edge 支援時顯示「安裝到電腦」：安裝後有桌面圖示、以獨立視窗開啟 */
export function InstallAppButton() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone) setInstalled(true);
    // iPhone／iPad 不支援自動安裝提示，改顯示「加入主畫面」說明
    setIos(/iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setEvt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  if (!evt && ios)
    return (
      <p className="mb-2 rounded-md bg-white/10 px-3 py-2 text-xs leading-relaxed text-[hsl(var(--sidebar-foreground))]/90">
        <MonitorDown className="mr-1 inline h-3.5 w-3.5" />
        安裝到手機：用 Safari 開啟，按下方「分享」<span className="whitespace-nowrap">（方框加箭頭）</span>→「加入主畫面」。
      </p>
    );
  if (!evt) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        await evt.prompt();
        await evt.userChoice;
        setEvt(null);
      }}
      className="mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[hsl(var(--sidebar-foreground))]/80 hover:bg-white/10 hover:text-white"
    >
      <MonitorDown className="h-4 w-4" />
      安裝到電腦／手機（桌面圖示）
    </button>
  );
}
