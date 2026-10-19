/**
 * 資料庫初始化：期限規則、預設範本、115 年辦公日曆、（選用）初始管理員與示範資料。
 * 可重複執行（冪等）。
 *
 *   npm run db:seed
 *   INITIAL_ADMIN_EMAIL=... INITIAL_ADMIN_PASSWORD=... INITIAL_ADMIN_NAME=... npm run db:seed
 *   SEED_DEMO=true npm run db:seed   # 另建立示範使用者與案件（僅限測試環境）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { isoToDbDate } from "../src/lib/dates";
import { parseCalendarJson } from "../src/server/business-days/calendar-import";
import { DEFAULT_DEADLINE_RULES } from "../src/server/schedule/deadline-rules";
import { ALL_DEFAULT_TEMPLATES, LEGACY_DEFAULT_TEMPLATES } from "../src/server/templates/default-templates";
import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";

const prisma = new PrismaClient();

async function seedRules() {
  const added: string[] = [];
  for (const r of DEFAULT_DEADLINE_RULES) {
    const exists = await prisma.deadlineRule.findUnique({ where: { taskType: r.taskType }, select: { id: true } });
    if (!exists) {
      await prisma.deadlineRule.create({ data: r });
      added.push(r.taskType);
    }
  }
  console.log(`✓ 期限規則 ${DEFAULT_DEADLINE_RULES.length} 筆${added.length ? `（新增 ${added.join("、")}）` : ""}`);
  const upgraded = await upgradeRules();
  if (added.length || upgraded) await backfillNewTasks();
}

/** 預設規則調整：仍為舊版預設值（未被管理員修改）者更新為新版，回傳是否有更新 */
async function upgradeRules(): Promise<boolean> {
  // 移除「提供圖說」工項後，創稿改以機關通知日推算（第 11 個工作天）
  const draft = DEFAULT_DEADLINE_RULES.find((r) => r.taskType === "PRE_REPORT_DRAFT")!;
  const reanchored = await prisma.deadlineRule.updateMany({
    where: { taskType: "PRE_REPORT_DRAFT", anchor: "PRE_REPORT_DISPATCH", offsetBusinessDays: -1 },
    data: { anchor: draft.anchor, offsetBusinessDays: draft.offsetBusinessDays, description: draft.description },
  });
  if (reanchored.count) {
    await prisma.task.updateMany({ where: { taskType: "PRE_REPORT_DRAFT", description: "提供圖說前第 1 個工作天完成創稿" }, data: { description: draft.description } });
    console.log("✓ 「事前規劃報告書創稿」改為機關通知日後第 11 個工作天");
  }
  // 排序：創稿（5）→ 提供事前規劃報告書（7）→ 提供圖說（10）
  await prisma.deadlineRule.updateMany({ where: { taskType: "PRE_REPORT_PROVIDE", sortOrder: 3 }, data: { sortOrder: 7 } });
  const next = DEFAULT_DEADLINE_RULES.find((r) => r.taskType === "PRE_REPORT_PROVIDE")!;
  const r = await prisma.deadlineRule.updateMany({
    where: { taskType: "PRE_REPORT_PROVIDE", anchor: "PRE_REPORT_DISPATCH", offsetBusinessDays: -2 },
    data: { anchor: next.anchor, offsetBusinessDays: next.offsetBusinessDays, description: next.description },
  });
  if (!r.count) return reanchored.count > 0;
  await prisma.task.updateMany({
    where: { taskType: "PRE_REPORT_PROVIDE", description: "事前規劃報告書提供圖說前第 2 個工作天，由負責同事提供報告書" },
    data: { description: next.description },
  });
  // 已完成的工作也依新規則更新顯示日期（暫時改為未開始以重新計算，之後恢復完成狀態與完成時間）
  const done = await prisma.task.findMany({
    where: { taskType: "PRE_REPORT_PROVIDE", status: "COMPLETED", overrideDueDate: null },
    select: { id: true, caseId: true, actualCompletedAt: true },
  });
  const { syncCaseTasks } = await import("../src/server/schedule/task-sync");
  for (const t of done) {
    await prisma.task.update({ where: { id: t.id }, data: { status: "NOT_STARTED" } });
    await syncCaseTasks(t.caseId, { actorId: null, source: "RULE_CHANGE", reason: "期限規則更新" });
    await prisma.task.update({ where: { id: t.id }, data: { status: "COMPLETED", actualCompletedAt: t.actualCompletedAt } });
  }
  console.log("✓ 「提供事前規劃報告書」期限改為機關通知日後第 12 個工作天");
  return true;
}

/** 新增期限規則後，為既有案件補建對應工作；後續步驟已完成者，新工作一併標記完成（避免既往案件產生逾期提醒） */
async function backfillNewTasks() {
  const { syncCaseTasks } = await import("../src/server/schedule/task-sync");
  const cases = await prisma.schoolCase.findMany({ where: { status: { in: ["ACTIVE", "ON_HOLD"] } }, select: { id: true } });
  for (const c of cases) {
    await syncCaseTasks(c.id, { actorId: null, source: "RULE_CHANGE", reason: "期限規則更新，補建或重新計算工作" });
  }
  const laterDone = await prisma.task.findMany({
    where: { taskType: { in: ["PRE_REPORT_DRAFT", "PRE_REPORT_DISPATCH"] }, status: "COMPLETED" },
    select: { caseId: true, actualCompletedAt: true },
  });
  let done = 0;
  for (const t of laterDone) {
    const r = await prisma.task.updateMany({
      where: { caseId: t.caseId, taskType: "PRE_REPORT_PROVIDE", status: { in: ["NOT_STARTED", "IN_PROGRESS"] } },
      data: { status: "COMPLETED", actualCompletedAt: t.actualCompletedAt ?? new Date() },
    });
    done += r.count;
  }
  console.log(`✓ 既有案件 ${cases.length} 件已補建新工作${done ? `（${done} 項因後續步驟已完成而標記完成）` : ""}`);
}

async function seedTemplates() {
  for (const t of ALL_DEFAULT_TEMPLATES) {
    const exists = await prisma.documentTemplate.findFirst({ where: { type: t.type } });
    if (!exists) {
      await prisma.documentTemplate.create({ data: { ...t, version: 1, isActive: true, changeNote: "系統預設範本" } });
    }
  }
  // 啟用中之範本若仍為「未修改過的舊版預設」，升級為新版預設（新增版本，舊版保留可回復）
  let upgraded = 0;
  for (const legacy of LEGACY_DEFAULT_TEMPLATES) {
    const active = await prisma.documentTemplate.findFirst({ where: { type: legacy.type, isActive: true }, orderBy: { version: "desc" } });
    const next = ALL_DEFAULT_TEMPLATES.find((t) => t.type === legacy.type);
    if (!active || !next || active.subject !== legacy.subject || active.body !== legacy.body) continue;
    await prisma.$transaction([
      prisma.documentTemplate.update({ where: { id: active.id }, data: { isActive: false } }),
      prisma.documentTemplate.create({
        data: { ...next, version: active.version + 1, isActive: true, changeNote: "系統更新預設範本（依使用者提供之格式）" },
      }),
    ]);
    upgraded++;
  }
  console.log(`✓ 預設範本 ${ALL_DEFAULT_TEMPLATES.length} 種${upgraded ? `（已升級 ${upgraded} 種為新版格式）` : ""}`);
}

async function seedCalendars() {
  const dir = path.join(process.cwd(), "data", "calendars");
  for (const file of ["2026.json"]) {
    const parsed = parseCalendarJson(readFileSync(path.join(dir, file), "utf8"));
    for (const y of parsed.years) {
      const existing = await prisma.calendarYear.findUnique({ where: { year: y.year } });
      if (existing) {
        console.log(`• ${y.year} 年辦公日曆已存在，略過（如需更新請由系統設定匯入）`);
        continue;
      }
      await prisma.$transaction([
        prisma.calendarYear.create({ data: { year: y.year, isComplete: y.isComplete, source: parsed.source ?? file, sourceNote: "系統初始化匯入" } }),
        prisma.holidayCalendar.createMany({ data: y.days.map((d) => ({ year: y.year, date: isoToDbDate(d.date), kind: d.kind, description: d.description })) }),
      ]);
      console.log(`✓ ${y.year} 年辦公日曆（${y.days.length} 筆，${y.isComplete ? "完整" : "非完整"}）`);
    }
  }
}

async function seedAdmin() {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (!admins) console.log("! 尚無管理員帳號：請執行 npm run admin:create 建立");
    return;
  }
  const err = validatePasswordStrength(password);
  if (err) {
    throw new Error(
      [
        "",
        "════════════════════════════════════════════",
        `✗ 無法建立管理員：INITIAL_ADMIN_PASSWORD 不符密碼規則（${err}）`,
        `  目前長度 ${password.length} 個字元；規則：至少 10 個字元，且需同時包含英文字母與數字。`,
        "  請到 Render → Environment 修改 INITIAL_ADMIN_PASSWORD 後按 Save Changes。",
        "════════════════════════════════════════════",
      ].join("\n"),
    );
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• 管理員 ${email} 已存在，未變更密碼`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name: process.env.INITIAL_ADMIN_NAME || "系統管理員",
      role: "ADMIN",
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      reminderPreference: { create: {} },
    },
  });
  console.log(`✓ 建立管理員 ${email}`);
}

async function seedDemo() {
  if (process.env.SEED_DEMO !== "true") return;
  if (process.env.NODE_ENV === "production") throw new Error("正式環境不可建立示範資料");
  const { syncCaseTasks } = await import("../src/server/schedule/task-sync");
  const demoPassword = "Demo12345678";
  const users = [
    { email: "admin@example.com", name: "王管理", role: "ADMIN" as const },
    { email: "chen@example.com", name: "陳工程師", role: "USER" as const },
    { email: "lin@example.com", name: "林工程師", role: "USER" as const },
  ];
  const ids: Record<string, string> = {};
  for (const u of users) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash: await hashPassword(demoPassword), reminderPreference: { create: {} } },
      update: {},
    });
    ids[u.email] = row.id;
  }
  const cases = [
    { projectCode: "TP115-001", schoolName: "臺北市大安區仁愛國民小學", district: "大安區", responsible: "chen@example.com", notification: "2026-09-21", review: "2026-10-16T14:00", visit: "2026-10-23T09:30" },
    { projectCode: "TP115-002", schoolName: "臺北市信義區永吉國民小學", district: "信義區", responsible: "chen@example.com", notification: "2026-10-01", review: "2026-10-30T10:00", visit: null },
    { projectCode: "TP115-003", schoolName: "臺北市士林區雨聲國民小學", district: "士林區", responsible: "lin@example.com", notification: "2026-10-07", review: null, visit: null },
  ];
  const { parseTaipeiDateTime } = await import("../src/lib/dates");
  for (const c of cases) {
    const row = await prisma.schoolCase.upsert({
      where: { projectCode: c.projectCode },
      create: {
        projectCode: c.projectCode,
        schoolName: c.schoolName,
        district: c.district,
        agencyName: "臺北市政府交通局",
        agencyContact: "張承辦",
        agencyEmail: "agency@example.com",
        responsibleUserId: ids[c.responsible],
        notificationDate: isoToDbDate(c.notification),
        reviewMeetingDateTime: c.review ? parseTaipeiDateTime(c.review) : null,
        reviewMeetingLocation: c.review ? "臺北市政府交通局會議室" : null,
        siteVisitDateTime: c.visit ? parseTaipeiDateTime(c.visit) : null,
        siteVisitLocation: c.visit ? "學校正門口" : null,
        siteVisitUploadUrl: c.visit ? "https://example.com/upload" : null,
      },
      update: {},
    });
    if (row.reviewMeetingDateTime && !(await prisma.meeting.count({ where: { caseId: row.id } }))) {
      await prisma.meeting.create({ data: { caseId: row.id, scheduledAt: row.reviewMeetingDateTime, location: row.reviewMeetingLocation } });
    }
    if (row.siteVisitDateTime && !(await prisma.siteVisit.count({ where: { caseId: row.id } }))) {
      await prisma.siteVisit.create({ data: { caseId: row.id, scheduledAt: row.siteVisitDateTime, location: row.siteVisitLocation, uploadUrl: row.siteVisitUploadUrl } });
    }
    await syncCaseTasks(row.id, { actorId: null, source: "CASE_CREATED", reason: "示範資料" });
  }
  console.log(`✓ 示範資料：使用者 ${users.length} 位（密碼 ${demoPassword}）、案件 ${cases.length} 筆`);
}

async function main() {
  await seedRules();
  await seedTemplates();
  await seedCalendars();
  await seedAdmin();
  await seedDemo();
  // 創稿工作由專案經理負責（既有案件一併調整）
  const { assignDraftTasksToPm } = await import("../src/server/schedule/task-sync");
  const n = await assignDraftTasksToPm();
  if (n) console.log(`✓ ${n} 項創稿工作改由專案經理負責`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
