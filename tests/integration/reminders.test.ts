import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createCase } from "@/server/cases/case-service";
import type { Mailer } from "@/server/reminders/mailer";
import { previewDigestForUser, resendDigestToUser, runDailyReminders } from "@/server/reminders/reminder-job";
import { caseInput, hasTestDb, makeUser, resetDatabase, seedBasics } from "../helpers/db";

function fakeMailer(fail = false): Mailer & { send: ReturnType<typeof vi.fn> } {
  return {
    name: "fake",
    send: vi.fn(async () => {
      if (fail) throw new Error("SMTP timeout");
      return { id: "msg-1" };
    }),
  };
}

// 2026-10-30（五）臺北 08:00 = UTC 00:00
const NOW = new Date("2026-10-30T00:00:00Z");

describe.skipIf(!hasTestDb)("12. 每日提醒排程", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedBasics();
    await prisma.systemSetting.create({ data: { key: "email", value: { testMode: false, testRecipient: null, skipNonBusinessDays: true } } });
  });

  it("同一日重複執行不重複寄信", async () => {
    const u = await makeUser("pm@example.com", "ADMIN");
    await createCase(u, caseInput({ responsibleUserId: u.id }));
    const mailer = fakeMailer();
    const first = await runDailyReminders({ now: NOW, mailer, trigger: "MANUAL" });
    const second = await runDailyReminders({ now: NOW, mailer, trigger: "MANUAL" });
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(await prisma.notificationLog.count()).toBe(1);
    const msg = mailer.send.mock.calls[0][0];
    expect(msg.to).toBe("pm@example.com");
    // 10/30 為事前規劃報告書創稿期限（今日到期）
    expect(msg.text).toContain("今日到期（1）");
    expect(await prisma.jobRun.count()).toBe(2);
  });

  it("同事只收到提供報告書／簡報／會議會勘／修正圖說提醒；管理員收到全部工作提醒", async () => {
    const pm = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    // 10/23 機關通知提送完整報告書 → 創稿 10/30、提送 11/2（10/26 放假）
    await createCase(pm, caseInput({ responsibleUserId: eng.id, finalReportNoticeDate: "2026-10-23" }));
    const mailer = fakeMailer();
    const r = await runDailyReminders({ now: NOW, mailer, trigger: "MANUAL" });
    expect(r.sent).toBe(2);
    const byTo = new Map((mailer.send.mock.calls as [{ to: string; text: string }][]).map((c) => [c[0].to, c[0].text]));
    const engText = byTo.get("eng@example.com")!;
    const pmText = byTo.get("pm@example.com")!;
    expect(engText).toContain("｜提供事前規劃報告書｜");
    expect(engText).toContain("｜提供審查簡報｜");
    expect(engText).toContain("｜審查後提供修正圖說｜");
    expect(engText).not.toContain("創稿");
    expect(engText).not.toContain("Email 審查會議紀錄");
    expect(engText).toContain("｜審查會議｜");
    expect(pmText).toContain("｜事前規劃報告書創稿｜");
    expect(pmText).toContain("｜審查會議｜");
    expect(pmText).toContain("｜提供事前規劃報告書｜");
    expect(pmText).toContain("｜提供審查簡報｜");
    expect(engText).toContain("｜提送完整規劃及分析報告書｜");
    expect(pmText).toContain("｜提送完整規劃及分析報告書｜");
    expect(pmText).toContain("｜完整規劃及分析報告書創稿｜");
  });

  it("網站未設定寄信服務時不會標記為已寄出；先前模擬寄出的紀錄仍會由正式排程補寄", async () => {
    const pm = await makeUser("pm@example.com", "ADMIN");
    await createCase(pm, caseInput({ responsibleUserId: pm.id }));
    const consoleMailer: Mailer = { name: "console", send: vi.fn(async () => ({ id: "console-1" })) };
    const r0 = await runDailyReminders({ now: NOW, mailer: consoleMailer });
    expect(r0.status).toBe("FAILED");
    expect(r0.message).toMatch(/未設定寄信服務/);
    expect(await prisma.notificationLog.count()).toBe(0);

    // 舊版留下的「模擬寄出」紀錄
    await prisma.notificationLog.create({
      data: { userId: pm.id, type: "DAILY_DIGEST", dedupeKey: `DAILY_DIGEST:${pm.id}:2026-10-30`, digestDate: new Date("2026-10-30"), recipient: pm.email, subject: "x", status: "SENT", attemptCount: 1, providerMessageId: "console-123", sentAt: new Date() },
    });
    const mailer = fakeMailer();
    const r1 = await runDailyReminders({ now: NOW, mailer });
    expect(r1.sent).toBe(1);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const log = await prisma.notificationLog.findFirstOrThrow();
    expect(log).toMatchObject({ status: "SENT", attemptCount: 2 });
    expect(log.providerMessageId).not.toMatch(/^console-/);
    // 真正寄出後不再重寄
    expect((await runDailyReminders({ now: NOW, mailer })).sent).toBe(0);
  });

  it("預覽同事的提醒信：內容與實際寄送相同，但不寄出也不寫入紀錄", async () => {
    const pm = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    await createCase(pm, caseInput({ responsibleUserId: eng.id }));
    const p = await previewDigestForUser(eng.id, NOW);
    expect(p.to).toBe("eng@example.com");
    expect(p.html).toContain("提供事前規劃報告書");
    expect(p.html).not.toContain("創稿");
    expect(p.note).toBeNull();
    expect(await prisma.notificationLog.count()).toBe(0);
  });

  it("補寄：當天已寄過仍可再寄一次給指定同事，並留下紀錄", async () => {
    const pm = await makeUser("pm@example.com", "ADMIN");
    const eng = await makeUser("eng@example.com");
    await createCase(pm, caseInput({ responsibleUserId: eng.id }));
    const mailer = fakeMailer();
    await runDailyReminders({ now: NOW, mailer, userIds: [eng.id] });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const r = await resendDigestToUser(eng.id, { now: NOW, mailer });
    expect(r.to).toBe("eng@example.com");
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(mailer.send.mock.calls[1][0].text).toContain("提供事前規劃報告書");
    expect(await prisma.notificationLog.count({ where: { userId: eng.id, status: "SENT" } })).toBe(2);
    const consoleMailer: Mailer = { name: "console", send: vi.fn() };
    await expect(resendDigestToUser(eng.id, { now: NOW, mailer: consoleMailer })).rejects.toThrow(/未設定寄信服務/);
    const idle = await makeUser("idle@example.com");
    await expect(resendDigestToUser(idle.id, { now: NOW, mailer })).rejects.toThrow(/沒有需要提醒/);
  });

  it("提醒信連結使用網站實際網址（優先於 APP_URL 設定）", async () => {
    const { rememberSiteUrl } = await import("@/server/settings/site-url");
    const pm = await makeUser("pm@example.com", "ADMIN");
    await createCase(pm, caseInput({ responsibleUserId: pm.id }));
    await rememberSiteUrl(new Headers({ host: "localhost:3000" }));
    expect(await prisma.systemSetting.findUnique({ where: { key: "siteUrl" } })).toBeNull();
    await rememberSiteUrl(new Headers({ "x-forwarded-host": "school-zone.onrender.com", "x-forwarded-proto": "https" }));
    const mailer = fakeMailer();
    await runDailyReminders({ now: NOW, mailer });
    const msg = mailer.send.mock.calls[0][0];
    expect(msg.html).toContain('href="https://school-zone.onrender.com/cases/');
    expect(msg.html).toContain('href="https://school-zone.onrender.com/"');
  });

  it("寄送失敗會記錄並可安全重試", async () => {
    const u = await makeUser("pm@example.com");
    await createCase(u, caseInput({ responsibleUserId: u.id }));
    const r1 = await runDailyReminders({ now: NOW, mailer: fakeMailer(true) });
    expect(r1).toMatchObject({ status: "FAILED", failed: 1 });
    const log = await prisma.notificationLog.findFirstOrThrow();
    expect(log.status).toBe("FAILED");
    expect(log.lastError).toContain("SMTP timeout");
    const ok = fakeMailer();
    const r2 = await runDailyReminders({ now: NOW, mailer: ok });
    expect(r2.sent).toBe(1);
    const after = await prisma.notificationLog.findFirstOrThrow();
    expect(after).toMatchObject({ status: "SENT", attemptCount: 2 });
    // 成功後再執行不會再寄
    await runDailyReminders({ now: NOW, mailer: ok });
    expect(ok.send).toHaveBeenCalledTimes(1);
  });

  it("測試模式改寄測試收件人；使用者可關閉每日摘要", async () => {
    const u = await makeUser("pm@example.com");
    const v = await makeUser("off@example.com");
    await prisma.reminderPreference.update({ where: { userId: v.id }, data: { dailyDigestEnabled: false } });
    await createCase(u, caseInput({ responsibleUserId: u.id }));
    await createCase(v, caseInput({ responsibleUserId: v.id, projectCode: "TP-002" }));
    await prisma.systemSetting.update({ where: { key: "email" }, data: { value: { testMode: true, testRecipient: "qa@example.com", skipNonBusinessDays: true } } });
    const mailer = fakeMailer();
    await runDailyReminders({ now: NOW, mailer });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send.mock.calls[0][0].to).toBe("qa@example.com");
    expect(mailer.send.mock.calls[0][0].subject).toContain("［測試］");
  });

  it("非工作天依設定不寄送（時區以臺北判定）", async () => {
    const u = await makeUser("pm@example.com");
    await createCase(u, caseInput({ responsibleUserId: u.id }));
    const mailer = fakeMailer();
    // UTC 2026-10-25 23:00 = 臺北 10/26（一）07:00，為光復節補假
    const r = await runDailyReminders({ now: new Date("2026-10-25T23:00:00Z"), mailer });
    expect(r.runDate).toBe("2026-10-26");
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("專案經理改收全部學校總表；各負責人仍收自己的提醒，且不重複寄送", async () => {
    const pm = await makeUser("pm-boss@example.com", "ADMIN", "林經理");
    const chen = await makeUser("chen@example.com", "USER", "陳工程師");
    const wang = await makeUser("wang@example.com", "USER", "王工程師");
    await prisma.reminderPreference.update({ where: { userId: pm.id }, data: { managerDigestEnabled: true } });
    await createCase(chen, caseInput({ responsibleUserId: chen.id, projectCode: "TP-A", schoolName: "仁愛國小" }));
    await createCase(wang, caseInput({ responsibleUserId: wang.id, projectCode: "TP-B", schoolName: "永吉國小" }));
    const mailer = fakeMailer();
    const r = await runDailyReminders({ now: NOW, mailer });
    expect(r.sent).toBe(3);
    const byTo = Object.fromEntries(mailer.send.mock.calls.map((c) => [c[0].to, c[0]]));
    expect(byTo["chen@example.com"].text).toContain("仁愛國小");
    expect(byTo["chen@example.com"].text).not.toContain("永吉國小");
    const overview = byTo["pm-boss@example.com"];
    expect(overview.subject).toContain("全部學校總表");
    expect(overview.text).toContain("仁愛國小｜陳工程師");
    expect(overview.text).toContain("永吉國小｜王工程師");
    expect(overview.html).toContain("負責人");
    expect(await prisma.notificationLog.count({ where: { type: "MANAGER_DIGEST" } })).toBe(1);
    await runDailyReminders({ now: NOW, mailer });
    expect(mailer.send).toHaveBeenCalledTimes(3);
  });

  it("一般使用者無法開啟全部學校總表", async () => {
    const { updateReminderPreference } = await import("@/server/users/user-service");
    const u = await makeUser("user@example.com");
    await updateReminderPreference(u, { emailEnabled: true, leadBusinessDays: 3, overdueEnabled: true, dailyDigestEnabled: true, managerDigestEnabled: true });
    expect((await prisma.reminderPreference.findUniqueOrThrow({ where: { userId: u.id } })).managerDigestEnabled).toBe(false);
  });
});
