import { CalendarClock, ExternalLink, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateDocumentButtons, CreateEmailButtons, EventHeldButton, MemberManager } from "@/components/cases/case-detail-client";
import { DeleteCaseButton } from "@/components/cases/delete-case-button";
import { PageHeader } from "@/components/common/page-header";
import { DueDateText, TaskStatusBadge, TaskTypeBadge } from "@/components/tasks/badges";
import { TaskActions } from "@/components/tasks/task-actions";
import { TaskEditDialog } from "@/components/tasks/task-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { dbDateToISOOrNull, formatROCDateTime, formatROCShort, taipeiToday } from "@/lib/dates";
import { canAccessCase } from "@/server/auth/permissions";
import { isAdmin } from "@/server/auth/types";
import { loadBusinessDayService } from "@/server/business-days/calendar-repository";
import { CASE_STATUS_LABELS } from "@/server/cases/case-schema";
import { getCaseDetail } from "@/server/cases/case-service";
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from "@/server/documents/document-variables";
import { EMAIL_DRAFT_STATUS_LABELS } from "@/server/emails/email-draft-service";
import { TEMPLATE_TYPE_LABELS } from "@/server/templates/default-templates";
import { computeDueInfo } from "@/server/tasks/task-utils";
import { ADMIN_ONLY_TASKS, REMOVED_TASKS, TASK_TIMELINE_ORDER } from "@/server/schedule/task-types";
import { listUsers } from "@/server/users/user-service";

const EVENT_STATUS = { SCHEDULED: "已排定", RESCHEDULED: "已改期", HELD: "已辦理", CANCELLED: "已取消" } as const;

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children || "—"}</dd>
    </div>
  );
}

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await canAccessCase(user, id, "view"))) notFound();
  const [c, bds, users, canEdit] = await Promise.all([getCaseDetail(user, id), loadBusinessDayService(), listUsers(), canAccessCase(user, id, "edit")]);
  const today = taipeiToday();
  const order: string[] = TASK_TIMELINE_ORDER;
  // 創稿工作僅管理員可見
  const visibleTasks = c.tasks.filter((t) => !REMOVED_TASKS.includes(t.taskType) && (isAdmin(user) || !ADMIN_ONLY_TASKS.includes(t.taskType)));
  const tasks = [...visibleTasks].sort((a, b) => order.indexOf(a.taskType) - order.indexOf(b.taskType)).map((t) => ({ ...t, due: computeDueInfo(t, bds, today) }));
  const histories = visibleTasks
    .flatMap((t) => t.histories.map((h) => ({ ...h, taskTitle: t.title })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 15);
  const canManageMembers = isAdmin(user) || c.responsibleUserId === user.id;
  const memberIds = new Set([c.responsibleUserId, ...c.members.map((m) => m.userId)]);

  return (
    <>
      <PageHeader
        title={c.schoolName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{c.projectCode}</span>
            <span>{c.projectName}</span>
            <Badge variant={c.status === "ACTIVE" ? "info" : "muted"}>{CASE_STATUS_LABELS[c.status]}</Badge>
          </span>
        }
        actions={
          <>
            {canEdit && (
              <Button asChild>
                <Link href={`/cases/${c.id}/edit`}>
                  <Pencil />
                  編輯案件／變更日期
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/calendar?caseId=${c.id}&view=list`}>
                <CalendarClock />
                案件行事曆
              </Link>
            </Button>
            {isAdmin(user) && (
              <DeleteCaseButton
                caseId={c.id}
                schoolName={c.schoolName}
                projectCode={c.projectCode}
                counts={{ tasks: visibleTasks.length, documents: c.documents.length, emails: c.emailDrafts.length }}
                redirectTo="/cases"
                size="default"
              />
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-3">
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Info label="行政區">{c.district}</Info>
              <Info label="負責人">
                {c.responsibleUser.name}
                <span className="block text-xs text-muted-foreground">{c.responsibleUser.email}</span>
              </Info>
              <Info label="機關">{c.agencyName}</Info>
              <Info label="承辦人">
                {c.agencyContact}
                {c.agencyEmail && <span className="block text-xs text-muted-foreground">{c.agencyEmail}</span>}
              </Info>
              <Info label="機關通知日（D0）">{formatROCShort(dbDateToISOOrNull(c.notificationDate))}</Info>
              <Info label="審查會議">
                {formatROCDateTime(c.reviewMeetingDateTime)}
                {c.reviewMeetingLocation && <span className="block text-xs text-muted-foreground">{c.reviewMeetingLocation}</span>}
              </Info>
              <Info label="會勘">
                {formatROCDateTime(c.siteVisitDateTime)}
                {c.siteVisitLocation && <span className="block text-xs text-muted-foreground">{c.siteVisitLocation}</span>}
              </Info>
              <Info label="機關通知提送完整報告書">{formatROCShort(dbDateToISOOrNull(c.finalReportNoticeDate))}</Info>
              <Info label="機關同意備查">{formatROCShort(dbDateToISOOrNull(c.finalReportApprovedDate))}</Info>
              <Info label="會勘簡報上傳">
                {c.siteVisitUploadUrl ? (
                  <a href={c.siteVisitUploadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    開啟連結 <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </Info>
            </dl>
            {c.notes && <p className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">{c.notes}</p>}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>期程工作</CardTitle>
            <p className="text-sm text-muted-foreground">每項工作可單獨完成；完成創稿不代表已提供圖說。</p>
          </CardHeader>
          <CardContent className="p-0">
            {tasks.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>工作類型</TH>
                    <TH>工作</TH>
                    <TH>截止日期</TH>
                    <TH>負責人</TH>
                    <TH>狀態</TH>
                    <TH>操作</TH>
                  </TR>
                </THead>
                <TBody>
                  {tasks.map((t) => (
                    <TR key={t.id} className={t.due.isOverdue ? "bg-red-50/50" : undefined}>
                      <TD>
                        <TaskTypeBadge taskType={t.taskType} />
                      </TD>
                      <TD className="min-w-[200px]">
                        <Link href={`/tasks/${t.id}`} className="hover:text-primary hover:underline">
                          {t.title}
                        </Link>
                        {t.overrideReason && <p className="text-xs text-muted-foreground">鎖定原因：{t.overrideReason}</p>}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <DueDateText dueDate={t.due.dueDate} remaining={t.due.remainingBusinessDays} status={t.status} estimated={t.dueDateEstimated} locked={t.due.isLocked} />
                      </TD>
                      <TD className="whitespace-nowrap">{t.assignedUser?.name ?? "未指派"}</TD>
                      <TD>
                        <TaskStatusBadge status={t.status} />
                      </TD>
                      <TD>
                        {canEdit ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <TaskActions taskId={t.id} caseId={c.id} taskType={t.taskType} status={t.status} title={t.title} uploadUrl={c.siteVisitUploadUrl} compact showCase={false} />
                            <TaskEditDialog
                              task={{
                                id: t.id,
                                title: t.title,
                                status: t.status,
                                calculatedDueDate: dbDateToISOOrNull(t.calculatedDueDate),
                                overrideDueDate: dbDateToISOOrNull(t.overrideDueDate),
                                overrideReason: t.overrideReason,
                                assignedUserId: t.assignedUserId,
                                reminderEnabled: t.reminderEnabled,
                              }}
                              users={users.map((u) => ({ id: u.id, name: u.name }))}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">僅檢視</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">尚未產生工作。請填寫機關通知日、審查會議或會勘日期，系統將自動建立工作項目。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>審查會議</CardTitle>
            {canEdit && c.meetings.some((m) => m.status === "SCHEDULED") && <EventHeldButton caseId={c.id} kind="REVIEW_MEETING" label="審查會議" />}
          </CardHeader>
          <CardContent>
            {c.meetings.length ? (
              <ul className="space-y-2 text-sm">
                {c.meetings.map((m) => (
                  <li key={m.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular">{formatROCDateTime(m.scheduledAt)}</span>
                      <Badge variant={m.status === "SCHEDULED" ? "info" : m.status === "HELD" ? "success" : "muted"}>{EVENT_STATUS[m.status]}</Badge>
                    </div>
                    {m.location && <p className="text-xs text-muted-foreground">{m.location}</p>}
                    {m.changeReason && <p className="text-xs text-amber-700">異動原因：{m.changeReason}</p>}
                    {m.notes && <p className="mt-1 whitespace-pre-wrap text-xs">{m.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">尚未排定審查會議。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>現場會勘</CardTitle>
            {canEdit && c.siteVisits.some((m) => m.status === "SCHEDULED") && <EventHeldButton caseId={c.id} kind="SITE_VISIT" label="會勘" />}
          </CardHeader>
          <CardContent>
            {c.siteVisits.length ? (
              <ul className="space-y-2 text-sm">
                {c.siteVisits.map((m) => (
                  <li key={m.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tabular">{formatROCDateTime(m.scheduledAt)}</span>
                      <Badge variant={m.status === "SCHEDULED" ? "info" : m.status === "HELD" ? "success" : "muted"}>{EVENT_STATUS[m.status]}</Badge>
                    </div>
                    {m.location && <p className="text-xs text-muted-foreground">{m.location}</p>}
                    {m.changeReason && <p className="text-xs text-amber-700">異動原因：{m.changeReason}</p>}
                    {m.notes && <p className="mt-1 whitespace-pre-wrap text-xs">{m.notes}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">尚未排定會勘。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>案件授權</CardTitle>
          </CardHeader>
          <CardContent>
            <MemberManager
              caseId={c.id}
              canManage={canManageMembers}
              members={c.members.map((m) => ({ userId: m.userId, name: m.user.name, role: m.role }))}
              candidates={users.filter((u) => !memberIds.has(u.id) && u.role !== "ADMIN").map((u) => ({ id: u.id, name: u.name }))}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader className="gap-2">
            <CardTitle>公文</CardTitle>
            {canEdit && <CreateDocumentButtons caseId={c.id} />}
          </CardHeader>
          <CardContent className="p-0">
            {c.documents.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>類型</TH>
                    <TH>狀態</TH>
                    <TH>發文字號</TH>
                    <TH>發文日期</TH>
                  </TR>
                </THead>
                <TBody>
                  {c.documents.map((d) => (
                    <TR key={d.id}>
                      <TD>
                        <Link href={`/documents/${d.id}`} className="text-primary hover:underline">
                          {DOCUMENT_TYPE_LABELS[d.documentType]}
                        </Link>
                      </TD>
                      <TD>
                        <Badge variant={d.status === "DISPATCHED" ? "success" : d.status === "DRAFTED" ? "info" : "muted"}>{DOCUMENT_STATUS_LABELS[d.status]}</Badge>
                      </TD>
                      <TD>{d.documentNumber ?? "—"}</TD>
                      <TD className="tabular">{formatROCShort(dbDateToISOOrNull(d.dispatchDate))}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">尚無公文草稿。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="gap-2">
            <CardTitle>Email 草稿</CardTitle>
            {canEdit && <CreateEmailButtons caseId={c.id} />}
          </CardHeader>
          <CardContent className="p-0">
            {c.emailDrafts.length ? (
              <ul className="divide-y">
                {c.emailDrafts.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <Link href={`/emails/${e.id}`} className="text-primary hover:underline">
                      {TEMPLATE_TYPE_LABELS[e.templateType]}
                    </Link>
                    <Badge variant={e.status === "CONFIRMED_SENT" ? "success" : "muted"}>{EMAIL_DRAFT_STATUS_LABELS[e.status]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">尚無 Email 草稿。</p>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>期限異動紀錄</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {histories.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>時間</TH>
                    <TH>工作</TH>
                    <TH>原期限</TH>
                    <TH>新期限</TH>
                    <TH>原因</TH>
                    <TH>操作者</TH>
                  </TR>
                </THead>
                <TBody>
                  {histories.map((h) => (
                    <TR key={h.id}>
                      <TD className="whitespace-nowrap tabular text-xs">{formatROCDateTime(h.createdAt)}</TD>
                      <TD>{h.taskTitle}</TD>
                      <TD className="tabular">{formatROCShort(dbDateToISOOrNull(h.previousDate))}</TD>
                      <TD className="tabular">{formatROCShort(dbDateToISOOrNull(h.newDate))}</TD>
                      <TD className="text-xs">{h.reason ?? "—"}</TD>
                      <TD className="text-xs">{h.changedBy?.name ?? "系統"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">尚無異動紀錄。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
