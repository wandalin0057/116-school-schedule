import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/common/page-header";
import { DueDateText, TaskStatusBadge } from "@/components/tasks/badges";
import { TaskActions } from "@/components/tasks/task-actions";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeleteVideoButton, VideoDialog } from "@/components/videos/video-dialogs";
import { requireUser } from "@/lib/auth";
import { dbDateToISOOrNull, formatROCShort, taipeiToday, type ISODate } from "@/lib/dates";
import type { BusinessDayService } from "@/server/business-days/business-day-service";
import { loadBusinessDayService } from "@/server/business-days/calendar-repository";
import { listProjectNames } from "@/server/cases/projects";
import { TASK_TYPE_LABELS } from "@/server/schedule/task-types";
import { computeDueInfo } from "@/server/tasks/task-utils";
import { listUsers } from "@/server/users/user-service";
import { STANDALONE_KINDS, type StandaloneKind } from "@/server/videos/standalone-kinds";
import { listVideos } from "@/server/videos/video-service";

type TaskLike = { id: string; status: Parameters<typeof computeDueInfo>[0]["status"]; calculatedDueDate: Date | null; overrideDueDate: Date | null };

function Due({ t, bds, today }: { t: TaskLike; bds: BusinessDayService; today: ISODate }) {
  const d = computeDueInfo(t, bds, today);
  return <DueDateText dueDate={d.dueDate} remaining={d.remainingBusinessDays} status={t.status} locked={d.isLocked} />;
}

/** 獨立項目頁（成果影片、成效分析及成果報告書共用） */
export async function StandalonePage({ kind, description }: { kind: StandaloneKind; description: string }) {
  const k = STANDALONE_KINDS[kind];
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const [items, users, bds, projects] = await Promise.all([listVideos(user, kind), admin ? listUsers() : Promise.resolve([]), loadBusinessDayService(), listProjectNames()]);
  const today = taipeiToday();

  return (
    <>
      <PageHeader title={k.label} description={description} actions={admin && <VideoDialog kind={kind} users={users} projects={projects} />} />
      <Card>
        {items.length === 0 ? (
          <EmptyState title={`尚無${k.label}`} description={admin ? `按右上角「新增${k.label}」建立。` : `目前沒有指派給您的${k.label}。`} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>學校</TH>
                  <TH>負責人</TH>
                  <TH>項目</TH>
                  <TH>機關通知日</TH>
                  {admin && <TH>創稿發文</TH>}
                  <TH>繳交期限</TH>
                  <TH>狀態</TH>
                  <TH className="text-right">操作</TH>
                </TR>
              </THead>
              <TBody>
                {items.flatMap((v) =>
                  v.stages.map((s, i) => {
                    const base = dbDateToISOOrNull(s.dateField === "notificationDate" ? v.notificationDate : v.resultVideoApprovedDate);
                    const first = i === 0;
                    return (
                      <TR key={`${v.id}-${s.taskType}`} className={first ? "border-t-2" : "border-t-0"}>
                        {first && (
                          <>
                            <TD rowSpan={v.stages.length} className="align-top font-medium">
                              {v.schoolName}
                              <span className="block text-xs font-normal text-muted-foreground">{v.projectName}</span>
                              {v.notes && <span className="mt-1 block whitespace-pre-line text-xs font-normal text-muted-foreground">{v.notes}</span>}
                            </TD>
                            <TD rowSpan={v.stages.length} className="align-top">
                              {v.responsibleUser.name}
                            </TD>
                          </>
                        )}
                        <TD className="whitespace-nowrap">{s.label}</TD>
                        <TD className="whitespace-nowrap">
                          {base ? formatROCShort(base) : <span className="text-xs text-muted-foreground">{s.dateField === "resultVideoApprovedDate" ? "審核同意後填寫" : "尚未通知"}</span>}
                        </TD>
                        {admin && (
                          <TD className="whitespace-nowrap">
                            {s.draft ? (
                              <div className="space-y-1">
                                <Due t={s.draft} bds={bds} today={today} />
                                <TaskActions taskId={s.draft.id} caseId={v.id} taskType={s.draftTaskType} status={s.draft.status} title={TASK_TYPE_LABELS[s.draftTaskType]} uploadUrl={null} compact showCase={false} />
                                {s.document && (
                                  <Link href={`/documents/${s.document.id}`} className="block text-xs text-primary hover:underline">
                                    查看公文
                                  </Link>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </TD>
                        )}
                        <TD className="whitespace-nowrap">{s.task ? <Due t={s.task} bds={bds} today={today} /> : "—"}</TD>
                        <TD>{s.task ? <TaskStatusBadge status={s.task.status} /> : "—"}</TD>
                        <TD>
                          <div className="flex flex-wrap justify-end gap-1">
                            {s.task && <TaskActions taskId={s.task.id} caseId={v.id} taskType={s.taskType} status={s.task.status} title={TASK_TYPE_LABELS[s.taskType]} uploadUrl={null} compact showCase={false} />}
                            {admin && first && (
                              <>
                                <VideoDialog
                                  kind={kind}
                                  users={users}
                                  projects={projects}
                                  video={{
                                    id: v.id,
                                    projectName: v.projectName,
                                    schoolName: v.schoolName,
                                    district: v.district ?? "",
                                    responsibleUserId: v.responsibleUserId,
                                    noticeDate: dbDateToISOOrNull(v.notificationDate) ?? "",
                                    approvedDate: dbDateToISOOrNull(v.resultVideoApprovedDate) ?? "",
                                    notes: v.notes ?? "",
                                  }}
                                />
                                <DeleteVideoButton kind={kind} id={v.id} label={v.schoolName} />
                              </>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  }),
                )}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
