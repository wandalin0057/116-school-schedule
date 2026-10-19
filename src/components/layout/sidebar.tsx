"use client";
import { Bell, CalendarDays, ClipboardList, FileText, LayoutDashboard, LogOut, Mail, Menu, School, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";
import { InstallAppButton } from "./install-app-button";

const NAV = [
  { href: "/", label: "儀表板", icon: LayoutDashboard },
  { href: "/cases", label: "學校案件", icon: School },
  { href: "/tasks", label: "工作待辦", icon: ClipboardList },
  { href: "/calendar", label: "行事曆", icon: CalendarDays },
  { href: "/documents", label: "公文管理", icon: FileText },
  { href: "/emails", label: "Email 草稿", icon: Mail },
  { href: "/notifications", label: "提醒紀錄", icon: Bell },
  { href: "/settings", label: "系統設定", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-white/15 font-semibold text-white" : "text-[hsl(var(--sidebar-foreground))]/80 hover:bg-white/10 hover:text-white",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-4 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
        <svg viewBox="0 0 32 32" className="h-5 w-5 text-white" aria-hidden>
          <path d="M9 22l7-12 7 12z" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
          <circle cx="16" cy="19" r="1.6" fill="#fbbf24" />
        </svg>
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold text-white">通學區案件管理</p>
        <p className="text-[11px] text-[hsl(var(--sidebar-foreground))]/70">期程暨發文管理系統</p>
      </div>
    </div>
  );
}

function UserBox({ name, role }: { name: string; role: string }) {
  return (
    <div className="border-t border-white/10 p-3">
      <div className="mb-2 px-1 text-sm">
        <p className="font-medium text-white">{name}</p>
        <p className="text-xs text-[hsl(var(--sidebar-foreground))]/70">{role === "ADMIN" ? "管理員" : "一般使用者"}</p>
      </div>
      <InstallAppButton />
      <form action={logoutAction}>
        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[hsl(var(--sidebar-foreground))]/80 hover:bg-white/10 hover:text-white">
          <LogOut className="h-4 w-4" />
          登出
        </button>
      </form>
    </div>
  );
}

export function Sidebar({ user }: { user: { name: string; role: string } }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      {/* 桌面版 */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[hsl(var(--sidebar))] lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks />
        </div>
        <UserBox name={user.name} role={user.role} />
      </aside>
      {/* 手機版頂部列 */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-[hsl(var(--sidebar))] px-3 lg:hidden">
        <Brand />
        <button className="rounded-md p-2 text-white hover:bg-white/10" onClick={() => setOpen(true)} aria-label="開啟選單">
          <Menu className="h-5 w-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-[hsl(var(--sidebar))]">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button className="rounded-md p-2 text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="關閉選單">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <UserBox name={user.name} role={user.role} />
          </aside>
        </div>
      )}
    </>
  );
}
