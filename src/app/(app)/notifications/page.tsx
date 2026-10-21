import type { NotificationStatus, Prisma } from "@prisma/client";
import { Eye } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ListControls } from "@/components/common/list-controls";
import { EmptyState, PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/table-nav";
import { RunRemindersButton } from "@/components/settings/run-reminders-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { dbDateToISO, formatROCDateTime, formatROCShort } from "@/lib/dates";
import { isAdmin } from "@/server/auth/types";
import { getEmailSettings } from "@/server/settings/settings-service";

export const metadata = { title: "提醒紀錄" };
type SP = Record<string, string | undefined>;

const STATUS: Record<NotificationStatus, { label: string; variant: "success" | "danger" | "muted" | "warning" }> = {
  SENT: { label: "已寄出", variant: "success" },
  FAILED: { label: "寄送失敗", variant: "danger" },
  PENDING: { label: "處理中", variant: "warning" },
  SKIPPED: { label: "略過", variant: "muted" },
};
const JOB_STATUS = { RUNNING: "執行中", SUCCEEDED: "成功", PARTIAL: "部分失敗", FAILED: "失敗" } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const admin = isAdmin(user);
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);
  const pageSize = 30;
  const where: Prisma.NotificationLogWhereInput = {
    ...(admin ? {} : { userId: user.id }),
    ...(sp.status && sp.status in STATUS ? { status: sp.status as NotificationStatus } : {}),
    ...(sp.q ? { OR: [{ recipient: { contains: sp.q, mode: "insensitive" } }, { subject: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [total, logs, jobs, settings] = await Promise.all([
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { name: true } } } }),
    admin ? prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }) : Promise.resolve([]),
    getEmailSettings(),
  ]);

  return (
    <>
      <PageHeader
        title="提醒紀錄"
        description="每日臺灣時間上午 8:30 起由背景排程寄送工作提醒。同一使用者同一日僅寄送一次。"
        actions={
          admin ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/notifications/preview">
                  <Eye />
                  預覽提醒信
                </Link>
              </Button>
            <RunRemindersButton
              testMode={settings.testMode}
              canSend={settings.provider !== "console"}
              actionsUrl={process.env.RENDER_GIT_REPO_SLUG ? `https://github.com/${process.env.RENDER_GIT_REPO_SLUG}/actions/workflows/daily-reminders.yml` : null}
            />
            </div>
          ) : undefined
        }
      />
      {settings.testMode && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          目前為 Email 測試模式：所有提醒將寄至測試收件人 {settings.testRecipient ?? "（未設定）"}。管理員可於「系統設定 → 通知設定」切換為正式寄送。
        </div>
      )}
      {admin && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>排程執行紀錄</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {jobs.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>執行日期</TH>
                    <TH>觸發</TH>
                    <TH>開始時間</TH>
                    <TH>結果</TH>
                    <TH>寄出／失敗／略過</TH>
                    <TH>訊息</TH>
                  </TR>
                </THead>
                <TBody>
                  {jobs.map((j) => (
                    <TR key={j.id}>
                      <TD className="tabular">{formatROCShort(dbDateToISO(j.runDate))}</TD>
                      <TD className="text-xs">{j.trigger === "CRON" ? "排程" : j.trigger === "API" ? "API" : "手動"}</TD>
                      <TD className="whitespace-nowrap text-xs tabular">{formatROCDateTime(j.startedAt)}</TD>
                      <TD>
                        <Badge variant={j.status === "SUCCEEDED" ? "success" : j.status === "RUNNING" ? "warning" : "danger"}>{JOB_STATUS[j.status]}</Badge>
                      </TD>
                      <TD className="tabular">
                        {j.sentCount}／{j.failedCount}／{j.skippedCount}
                      </TD>
                      <TD className="text-xs">{j.message}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState title="尚無排程執行紀錄" />
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{admin ? "寄送紀錄（全部使用者）" : "我的提醒紀錄"}</CardTitle>
        </CardHeader>
        <div className="border-b p-3">
          <ListControls searchPlaceholder="搜尋收件人、主旨…" filters={[{ name: "status", label: "狀態", options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) }]} />
        </div>
        {logs.length ? (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>提醒日期</TH>
                  <TH>使用者</TH>
                  <TH>收件人</TH>
                  <TH>主旨</TH>
                  <TH>項目數</TH>
                  <TH>狀態</TH>
                  <TH>嘗試</TH>
                  <TH>寄出時間</TH>
                </TR>
              </THead>
              <TBody>
                {logs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap tabular">{formatROCShort(dbDateToISO(l.digestDate))}</TD>
                    <TD className="whitespace-nowrap">{l.user.name}</TD>
                    <TD className="text-xs">
                      {l.recipient}
                      {l.isTestMode && (
                        <Badge variant="warning" className="ml-1">
                          測試
                        </Badge>
                      )}
                    </TD>
                    <TD className="max-w-xs truncate text-xs" title={l.subject}>
                      {l.subject}
                    </TD>
                    <TD className="tabular">{l.itemCount}</TD>
                    <TD>
                      {l.status === "SENT" && l.providerMessageId?.startsWith("console-") ? (
                        <Badge variant="warning" title="網站未設定寄信服務，只模擬寄送；正式排程會重新寄出">未實際寄出</Badge>
                      ) : (
                        <Badge variant={STATUS[l.status].variant}>{STATUS[l.status].label}</Badge>
                      )}
                      {l.lastError && <p className="mt-0.5 max-w-xs truncate text-xs text-red-700" title={l.lastError}>{l.lastError}</p>}
                    </TD>
                    <TD className="tabular">{l.attemptCount}</TD>
                    <TD className="whitespace-nowrap text-xs tabular">{formatROCDateTime(l.sentAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination total={total} page={page} pageSize={pageSize} pathname="/notifications" params={sp} />
          </>
        ) : (
          <EmptyState title="尚無提醒紀錄" />
        )}
      </Card>
    </>
  );
}
