import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dbDateToISO } from "@/lib/dates";
import { createCase, previewCaseUpdate, updateCase } from "@/server/cases/case-service";
import { completeTask, setTaskOverride } from "@/server/tasks/task-service";
import { syncCaseTasks } from "@/server/schedule/task-sync";
import { caseInput, hasTestDb, makeUser, resetDatabase, seedBasics } from "../helpers/db";

const dueOf = async (caseId: string, taskType: string) => {
  const t = await prisma.task.findFirstOrThrow({ where: { caseId, taskType: taskType as never } });
  return { ...t, due: t.calculatedDueDate ? dbDateToISO(t.calculatedDueDate) : null };
};

describe.skipIf(!hasTestDb)("案件期程同步（資料庫）", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedBasics();
  });

  it("建立案件時依規則建立工作，且不重複建立", async () => {
    const u = await makeUser("pm@example.com");
    const { schoolCase } = await createCase(u, caseInput({ responsibleUserId: u.id }));
    const tasks = await prisma.task.findMany({ where: { caseId: schoolCase.id } });
    // 通知日 2 項 + 審查會議 5 項
    expect(tasks).toHaveLength(7);
    expect((await dueOf(schoolCase.id, "PRE_REPORT_PROVIDE")).due).toBe("2026-11-02");
    expect((await dueOf(schoolCase.id, "PRE_REPORT_DRAFT")).due).toBe("2026-10-30");
    await syncCaseTasks(schoolCase.id, { actorId: u.id, source: "MANUAL_RECALC" });
    await syncCaseTasks(schoolCase.id, { actorId: u.id, source: "MANUAL_RECALC" });
    expect(await prisma.task.count({ where: { caseId: schoolCase.id } })).toBe(7);
  });

  it("10. 變更會議日期後期限正確更新，並保留異動歷史與差異預覽", async () => {
    const u = await makeUser("pm@example.com");
    const { schoolCase } = await createCase(u, caseInput({ responsibleUserId: u.id }));
    expect((await dueOf(schoolCase.id, "REVIEW_MINUTES_EMAIL")).due).toBe("2026-10-23");

    const preview = await previewCaseUpdate(u, schoolCase.id, caseInput({ responsibleUserId: u.id, reviewMeetingDateTime: "2026-10-29T10:00" }));
    expect(preview.find((c) => c.taskType === "REVIEW_MINUTES_EMAIL")).toMatchObject({ action: "UPDATE", previousDate: "2026-10-23", newDate: "2026-10-30" });
    // 預覽不寫入
    expect((await dueOf(schoolCase.id, "REVIEW_MINUTES_EMAIL")).due).toBe("2026-10-23");

    await updateCase(u, schoolCase.id, caseInput({ responsibleUserId: u.id, reviewMeetingDateTime: "2026-10-29T10:00", dateChangeReason: "機關改期" }));
    expect((await dueOf(schoolCase.id, "REVIEW_SLIDES_EMAIL")).due).toBe("2026-10-27");
    expect((await dueOf(schoolCase.id, "REVIEW_MINUTES_EMAIL")).due).toBe("2026-10-30");
    expect((await dueOf(schoolCase.id, "REVIEW_DRAWING_DISPATCH")).due).toBe("2026-11-03");

    const t = await dueOf(schoolCase.id, "REVIEW_MINUTES_EMAIL");
    const history = await prisma.taskDueDateHistory.findMany({ where: { taskId: t.id, changeSource: "CASE_DATE_CHANGE" } });
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe("機關改期");
    const meetings = await prisma.meeting.findMany({ where: { caseId: schoolCase.id }, orderBy: { createdAt: "asc" } });
    expect(meetings.map((m) => m.status)).toEqual(["RESCHEDULED", "SCHEDULED"]);
    expect(await prisma.auditLog.count({ where: { action: "CASE_DATE_CHANGE" } })).toBe(1);
    expect(await prisma.task.count({ where: { caseId: schoolCase.id } })).toBe(7);
  });

  it("11. 已完成工作不會被重新設定為未完成，期限亦不變", async () => {
    const u = await makeUser("pm@example.com", "ADMIN");
    const { schoolCase } = await createCase(u, caseInput({ responsibleUserId: u.id }));
    const slides = await dueOf(schoolCase.id, "REVIEW_SLIDES_EMAIL");
    await completeTask(u, slides.id);
    await updateCase(u, schoolCase.id, caseInput({ responsibleUserId: u.id, reviewMeetingDateTime: "2026-11-05T10:00" }));
    const after = await dueOf(schoolCase.id, "REVIEW_SLIDES_EMAIL");
    expect(after.status).toBe("COMPLETED");
    expect(after.actualCompletedAt).not.toBeNull();
    expect(after.due).toBe("2026-10-20");
    // 未完成之工作則更新
    expect((await dueOf(schoolCase.id, "REVIEW_MINUTES_EMAIL")).due).toBe("2026-11-06");
  });

  it("人工鎖定之期限不被日期變更覆蓋", async () => {
    const u = await makeUser("pm@example.com");
    const { schoolCase } = await createCase(u, caseInput({ responsibleUserId: u.id }));
    const provide = await dueOf(schoolCase.id, "PRE_REPORT_PROVIDE");
    await expect(setTaskOverride(u, provide.id, { overrideDueDate: "2026-11-10" })).rejects.toThrow(/原因/);
    await setTaskOverride(u, provide.id, { overrideDueDate: "2026-11-10", overrideReason: "機關要求延後" });
    await updateCase(u, schoolCase.id, caseInput({ responsibleUserId: u.id, notificationDate: "2026-10-15" }));
    const locked = await dueOf(schoolCase.id, "PRE_REPORT_PROVIDE");
    expect(dbDateToISO(locked.overrideDueDate!)).toBe("2026-11-10");
    expect(locked.due).toBe("2026-11-02");
    expect(await prisma.task.count({ where: { caseId: schoolCase.id, taskType: "PRE_REPORT_DISPATCH" } })).toBe(0);
  });

  it("日期可分次填寫：補填會勘日期後才建立會勘工作", async () => {
    const u = await makeUser("pm@example.com");
    const { schoolCase } = await createCase(u, caseInput({ responsibleUserId: u.id, reviewMeetingDateTime: "" }));
    expect(await prisma.task.count({ where: { caseId: schoolCase.id } })).toBe(2);
    await updateCase(u, schoolCase.id, caseInput({ responsibleUserId: u.id, reviewMeetingDateTime: "", siteVisitDateTime: "2026-11-11T09:30" }));
    expect((await dueOf(schoolCase.id, "SITE_VISIT_SLIDES_UPLOAD")).due).toBe("2026-11-09");
    expect(await prisma.task.count({ where: { caseId: schoolCase.id } })).toBe(7);
  });

  it("案件編號不得重複", async () => {
    const u = await makeUser("pm@example.com");
    await createCase(u, caseInput({ responsibleUserId: u.id }));
    await expect(createCase(u, caseInput({ responsibleUserId: u.id, projectCode: "tp-001" }))).rejects.toThrow(/案件編號已存在/);
  });

  it("新增案件時填寫負責人姓名與 Email：新 Email 自動建立提醒收件帳號，既有 Email 直接連結", async () => {
    const { authenticate } = await import("@/server/auth/login");
    const admin = await makeUser("pm@example.com", "ADMIN", "林經理");
    const { schoolCase } = await createCase(admin, caseInput({ responsibleName: "陳工程師", responsibleEmail: "Chen@Example.com" }));
    const chen = await prisma.user.findUniqueOrThrow({ where: { email: "chen@example.com" } });
    expect(chen).toMatchObject({ name: "陳工程師", role: "USER", isActive: true });
    expect(schoolCase.responsibleUserId).toBe(chen.id);
    // 工作指派給負責人（提醒信寄給他）
    expect(await prisma.task.count({ where: { caseId: schoolCase.id, assignedUserId: chen.id } })).toBe(5) // 創稿 2 項由專案經理負責;
    // 自動建立的帳號不能直接登入
    expect((await authenticate("chen@example.com", "")).ok).toBe(false);
    // 第二所學校用同一個 Email：不重複建立帳號
    const second = await createCase(admin, caseInput({ projectCode: "TP-002", responsibleName: "陳工程師", responsibleEmail: "chen@example.com" }));
    expect(second.schoolCase.responsibleUserId).toBe(chen.id);
    expect(await prisma.user.count({ where: { email: "chen@example.com" } })).toBe(1);
    // 改負責人：工作轉給新負責人
    await updateCase(admin, schoolCase.id, caseInput({ responsibleName: "王工程師", responsibleEmail: "wang@example.com" }));
    const wang = await prisma.user.findUniqueOrThrow({ where: { email: "wang@example.com" } });
    expect(await prisma.task.count({ where: { caseId: schoolCase.id, assignedUserId: wang.id } })).toBe(5);
  });

  it("標記完成與變更狀態僅限管理員；一般使用者（含負責人）只能檢視進度", async () => {
    const { updateTaskStatus } = await import("@/server/tasks/task-service");
    const { markEventHeld } = await import("@/server/cases/case-service");
    const admin = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    const { schoolCase } = await createCase(admin, caseInput({ responsibleUserId: eng.id }));
    const task = await prisma.task.findFirstOrThrow({ where: { caseId: schoolCase.id, taskType: "PRE_REPORT_PROVIDE" } });
    await expect(completeTask(eng, task.id)).rejects.toThrow(/只有管理員/);
    await expect(updateTaskStatus(eng, task.id, "IN_PROGRESS")).rejects.toThrow(/只有管理員/);
    await expect(markEventHeld(eng, schoolCase.id, "REVIEW_MEETING", {})).rejects.toThrow(/只有管理員/);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("NOT_STARTED");
    await completeTask(admin, task.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("COMPLETED");
    expect(task.title).toBe("提供事前規劃報告書");
  });

  it("創稿工作只顯示給管理員：一般使用者的工作清單、儀表板與行事曆不包含創稿", async () => {
    const { listTasks, getTask } = await import("@/server/tasks/task-service");
    const { getDashboard } = await import("@/server/dashboard/dashboard-service");
    const admin = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    const { schoolCase } = await createCase(admin, caseInput({ responsibleUserId: eng.id }));
    const engTasks = await listTasks(eng, { pageSize: 100 });
    const adminTasks = await listTasks(admin, { pageSize: 100 });
    const types = (r: { items: { taskType: string }[] }) => r.items.map((t) => t.taskType);
    expect(types(engTasks).some((t) => t.endsWith("_DRAFT"))).toBe(false);
    expect(types(adminTasks)).toContain("PRE_REPORT_DRAFT");
    expect(types(engTasks)).toContain("PRE_REPORT_PROVIDE");
    const draft = await prisma.task.findFirstOrThrow({ where: { caseId: schoolCase.id, taskType: "PRE_REPORT_DRAFT" } });
    await expect(getTask(eng, draft.id)).rejects.toThrow(/找不到/);
    await expect(getTask(admin, draft.id)).resolves.toBeTruthy();
    const dash = await getDashboard(eng, {});
    expect(dash.pendingDraft).toHaveLength(0);
  });

  it("創稿工作的負責人是專案經理（管理員），其他工作是案件負責人", async () => {
    const { assignDraftTasksToPm } = await import("@/server/schedule/task-sync");
    const pm = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    const { schoolCase } = await createCase(pm, caseInput({ responsibleUserId: eng.id }));
    const tasks = await prisma.task.findMany({ where: { caseId: schoolCase.id } });
    for (const t of tasks) expect(t.assignedUserId).toBe(t.taskType.endsWith("_DRAFT") ? pm.id : eng.id);
    // 舊資料：創稿指派給同事 → 調整為專案經理
    await prisma.task.updateMany({ where: { caseId: schoolCase.id, taskType: "PRE_REPORT_DRAFT" }, data: { assignedUserId: eng.id } });
    await prisma.task.updateMany({ where: { caseId: schoolCase.id, taskType: "REVIEW_DRAWING_DRAFT" }, data: { assignedUserId: eng.id, status: "COMPLETED" } });
    expect(await assignDraftTasksToPm()).toBe(2);
    expect((await prisma.task.findFirstOrThrow({ where: { caseId: schoolCase.id, taskType: "REVIEW_DRAWING_DRAFT" } })).assignedUserId).toBe(pm.id);
    expect((await prisma.task.findFirstOrThrow({ where: { caseId: schoolCase.id, taskType: "PRE_REPORT_DRAFT" } })).assignedUserId).toBe(pm.id);
  });

  it("一般使用者不能以新 Email 自動建立帳號；未填負責人 Email 時提示", async () => {
    const u = await makeUser("user@example.com");
    await expect(createCase(u, caseInput({ responsibleName: "新人", responsibleEmail: "new@example.com" }))).rejects.toThrow(/尚未建立帳號/);
    await expect(createCase(u, caseInput({}))).rejects.toThrow(/負責人 Email/);
    await expect(createCase(u, caseInput({ responsibleName: "我", responsibleEmail: "user@example.com" }))).resolves.toBeTruthy();
  });

  it("計畫分類：可依計畫名稱篩選案件、待辦與儀表板", async () => {
    const { listCases } = await import("@/server/cases/case-service");
    const { listTasks } = await import("@/server/tasks/task-service");
    const { getDashboard } = await import("@/server/dashboard/dashboard-service");
    const { countCasesByProject, listProjectNames } = await import("@/server/cases/projects");
    const admin = await makeUser("pm@example.com", "ADMIN");
    const P115 = "115年度臺北市通學區規劃分析案";
    const P116 = "116年度臺北市通學區規劃分析案";
    await createCase(admin, caseInput({ responsibleUserId: admin.id, projectCode: "A115", projectName: P115, schoolName: "甲國小" }));
    await createCase(admin, caseInput({ responsibleUserId: admin.id, projectCode: "B116", projectName: P116, schoolName: "乙國小" }));
    await createCase(admin, caseInput({ responsibleUserId: admin.id, projectCode: "C116", projectName: P116, schoolName: "丙國小" }));
    expect((await listProjectNames(admin)).slice(0, 2)).toEqual([P116, P115]);
    expect((await countCasesByProject(admin)).get(P116)).toBe(2);
    expect((await listCases(admin, { projectName: P116 })).items.map((c) => c.schoolName).sort()).toEqual(["丙國小", "乙國小"]);
    const tasks = await listTasks(admin, { view: "all", projectName: P115, pageSize: 200 });
    expect(new Set(tasks.items.map((t) => t.schoolCase.schoolName))).toEqual(new Set(["甲國小"]));
    const dash = await getDashboard(admin, { projectName: P116, now: new Date("2026-10-15T01:00:00Z") });
    expect(dash.progress.map((p) => p.schoolName).sort()).toEqual(["丙國小", "乙國小"]);
  });
});
