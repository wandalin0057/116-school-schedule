import { EmptyState, PageHeader } from "@/components/common/page-header";
import { DueDateText, TaskStatusBadge } from "@/components/tasks/badges";
import { TaskActions } from "@/components/tasks/task-actions";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DeleteVideoButton, VideoDialog } from "@/components/videos/video-dialogs";
import { requireUser } from "@/lib/auth";
import { dbDateToISOOrNull, taipeiToday } from "@/lib/dates";
import { loadBusinessDayService } from "@/server/business-days/calendar-repository";
import { computeDueInfo } from "@/server/tasks/task-utils";
import { listUsers } from "@/server/users/user-service";
import { listVideos } from "@/server/videos/video-service";

export const metadata = { title: "成果影片" };

export default async function VideosPage() {
  const user = await requireUser();
  const admin = user.role === "ADMIN";
  const [videos, users, bds] = await Promise.all([listVideos(user), admin ? listUsers() : Promise.resolve([]), loadBusinessDayService()]);
  const today = taipeiToday();

  return (
    <>
      <PageHeader
        title="成果影片"
        description="成果影片獨立於通學區學校案件管理（製作影片的學校可能不同）。期限前會寄每日提醒給負責人。"
        actions={admin && <VideoDialog users={users} />}
      />
      <Card>
        {videos.length === 0 ? (
          <EmptyState title="尚無成果影片" description={admin ? "按右上角「新增成果影片」建立。" : "目前沒有指派給您的成果影片。"} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>學校</TH>
                  <TH>行政區</TH>
                  <TH>負責人</TH>
                  <TH>期限</TH>
                  <TH>狀態</TH>
                  <TH>備註</TH>
                  <TH className="text-right">操作</TH>
                </TR>
              </THead>
              <TBody>
                {videos.map((v) => {
                  const due = v.task ? computeDueInfo(v.task, bds, today) : null;
                  return (
                    <TR key={v.id}>
                      <TD className="font-medium">{v.schoolName}</TD>
                      <TD>{v.district ?? "—"}</TD>
                      <TD>{v.responsibleUser.name}</TD>
                      <TD className="whitespace-nowrap">
                        {v.task && due ? <DueDateText dueDate={due.dueDate} remaining={due.remainingBusinessDays} status={v.task.status} locked={due.isLocked} /> : "—"}
                      </TD>
                      <TD>{v.task ? <TaskStatusBadge status={v.task.status} /> : "—"}</TD>
                      <TD className="max-w-xs whitespace-pre-line text-xs text-muted-foreground">{v.notes ?? ""}</TD>
                      <TD>
                        <div className="flex flex-wrap justify-end gap-1">
                          {v.task && <TaskActions taskId={v.task.id} caseId={v.id} taskType="RESULT_VIDEO" status={v.task.status} title="提供成果影片" uploadUrl={null} compact showCase={false} />}
                          {admin && (
                            <>
                              <VideoDialog
                                users={users}
                                video={{
                                  id: v.id,
                                  schoolName: v.schoolName,
                                  district: v.district ?? "",
                                  responsibleUserId: v.responsibleUserId,
                                  dueDate: dbDateToISOOrNull(v.resultVideoDueDate) ?? "",
                                  notes: v.notes ?? "",
                                }}
                              />
                              <DeleteVideoButton id={v.id} label={v.schoolName} />
                            </>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
