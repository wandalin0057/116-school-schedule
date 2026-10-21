/**
 * 每日工作提醒排程（獨立執行，不依賴網站是否有人開啟）。
 * GitHub Actions／Cron：每天 UTC 00:30（臺灣時間 08:30 起寄出，另有備援排程）
 *
 *   npm run cron:daily-reminders
 *   npm run cron:daily-reminders -- --force   # 非工作天也執行
 *   RESEND_EMAIL=someone@example.com npm run cron:daily-reminders   # 只補寄給這位使用者
 */
import { prisma } from "../src/lib/db";
import { resendDigestToUser, runDailyReminders } from "../src/server/reminders/reminder-job";

async function main() {
  const resendEmail = process.env.RESEND_EMAIL?.trim().toLowerCase();
  if (resendEmail) {
    const user = await prisma.user.findUnique({ where: { email: resendEmail }, select: { id: true } });
    if (!user) throw new Error(`找不到使用者：${resendEmail}`);
    const r = await resendDigestToUser(user.id);
    console.log(JSON.stringify({ resend: true, to: r.to }));
    return;
  }
  const summary = await runDailyReminders({ trigger: "CRON", force: process.argv.includes("--force") });
  console.log(JSON.stringify(summary));
  if (summary.status === "FAILED") process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
