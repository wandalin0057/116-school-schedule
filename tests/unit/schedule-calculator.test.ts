import { describe, expect, it } from "vitest";
import { DEFAULT_DEADLINE_RULES } from "@/server/schedule/deadline-rules";
import { calculateSchedule, diffSchedule, type ExistingTaskSnapshot } from "@/server/schedule/schedule-calculator";
import { bds2026 } from "../helpers/calendar";

const bds = bds2026();
const due = (list: ReturnType<typeof calculateSchedule>, type: string) => list.find((c) => c.taskType === type)?.dueDate;

describe("期程自動計算", () => {
  const schedule = calculateSchedule(
    { notificationDate: "2026-10-14", reviewMeetingDate: "2026-10-22", siteVisitDate: "2026-04-08" },
    DEFAULT_DEADLINE_RULES,
    bds,
  );

  it("5. 機關通知後第 12 工作天提供事前規劃報告書；不再產生「提供圖說」工項", () => {
    expect(due(schedule, "PRE_REPORT_PROVIDE")).toBe("2026-11-02");
    expect(schedule.some((c) => c.taskType === "PRE_REPORT_DISPATCH")).toBe(false);
  });

  it("9. 機關通知後第 11 工作天完成創稿", () => {
    expect(due(schedule, "PRE_REPORT_DRAFT")).toBe("2026-10-30");
  });

  it("6、7. 審查會議前 2、後 1、2、3 工作天", () => {
    expect(due(schedule, "REVIEW_SLIDES_EMAIL")).toBe("2026-10-20");
    expect(due(schedule, "REVIEW_MEETING")).toBe("2026-10-22");
    expect(due(schedule, "REVIEW_MINUTES_EMAIL")).toBe("2026-10-23");
    expect(due(schedule, "REVIEW_DRAWING_DRAFT")).toBe("2026-10-27");
    expect(due(schedule, "REVIEW_DRAWING_DISPATCH")).toBe("2026-10-28");
  });

  it("8. 會勘前 2、後 1、2、3 工作天", () => {
    expect(due(schedule, "SITE_VISIT_SLIDES_UPLOAD")).toBe("2026-04-02");
    expect(due(schedule, "SITE_VISIT")).toBe("2026-04-08");
    expect(due(schedule, "SITE_VISIT_MINUTES_EMAIL")).toBe("2026-04-09");
    expect(due(schedule, "SITE_VISIT_DRAWING_DRAFT")).toBe("2026-04-10");
    expect(due(schedule, "SITE_VISIT_DRAWING_DISPATCH")).toBe("2026-04-13");
  });

  it("日期可分次填寫：未填之事件不產生期限", () => {
    const partial = calculateSchedule({ notificationDate: "2026-10-14", reviewMeetingDate: null, siteVisitDate: null }, DEFAULT_DEADLINE_RULES, bds);
    expect(due(partial, "PRE_REPORT_PROVIDE")).toBe("2026-11-02");
    expect(due(partial, "REVIEW_MEETING")).toBeNull();
    expect(due(partial, "SITE_VISIT")).toBeNull();
  });

  it("依附其他工作之規則：上游人工鎖定時以鎖定日為基準", () => {
    const rules = DEFAULT_DEADLINE_RULES.map((r) =>
      r.taskType === "PRE_REPORT_DISPATCH" ? { ...r, enabled: true } : r.taskType === "PRE_REPORT_DRAFT" ? { ...r, anchor: "PRE_REPORT_DISPATCH" as const, offsetBusinessDays: -1 } : r,
    );
    const s = calculateSchedule({ notificationDate: "2026-10-14", reviewMeetingDate: null, siteVisitDate: null }, rules, bds, {
      effectiveDueDates: { PRE_REPORT_DISPATCH: "2026-11-10" },
    });
    expect(due(s, "PRE_REPORT_DRAFT")).toBe("2026-11-09");
  });
});

describe("完整報告書與對照圖卡", () => {
  it("機關通知次日起第 5 個工作天提送完整報告書；同意備查日起第 15 個工作天提供對照圖卡", () => {
    const s = calculateSchedule(
      { notificationDate: null, reviewMeetingDate: null, siteVisitDate: null, finalReportNoticeDate: "2026-10-14", finalReportApprovedDate: "2026-11-02" },
      DEFAULT_DEADLINE_RULES,
      bds,
    );
    // 10/14（三）→ 15、16、19、20、21 → 10/21
    expect(due(s, "FINAL_REPORT_SUBMIT")).toBe("2026-10-21");
    expect(due(s, "BEFORE_AFTER_CARDS")).toBe(bds.addBusinessDays("2026-11-02", 15).date);
  });

  it("創稿在提送／提供的前一個工作天", () => {
    const s = calculateSchedule(
      { notificationDate: null, reviewMeetingDate: null, siteVisitDate: null, finalReportNoticeDate: "2026-10-14", finalReportApprovedDate: "2026-11-02" },
      DEFAULT_DEADLINE_RULES,
      bds,
    );
    expect(due(s, "FINAL_REPORT_DRAFT")).toBe("2026-10-20");
    expect(due(s, "BEFORE_AFTER_CARDS_DRAFT")).toBe(bds.addBusinessDays("2026-11-02", 14).date);
    expect(bds.addBusinessDays(due(s, "BEFORE_AFTER_CARDS_DRAFT")!, 1).date).toBe(due(s, "BEFORE_AFTER_CARDS"));
  });

  it("未填日期時不產生期限", () => {
    const s = calculateSchedule({ notificationDate: "2026-10-14", reviewMeetingDate: null, siteVisitDate: null }, DEFAULT_DEADLINE_RULES, bds);
    expect(due(s, "FINAL_REPORT_SUBMIT")).toBeNull();
    expect(due(s, "BEFORE_AFTER_CARDS")).toBeNull();
  });
});

describe("期限差異比對", () => {
  const base = (over: Partial<ExistingTaskSnapshot>): ExistingTaskSnapshot => ({
    id: "t1",
    taskType: "REVIEW_MINUTES_EMAIL",
    title: "Email 提供審查會議紀錄",
    status: "NOT_STARTED",
    calculatedDueDate: "2026-10-23",
    dueDateEstimated: false,
    overrideDueDate: null,
    ...over,
  });
  const computed = calculateSchedule({ notificationDate: null, reviewMeetingDate: "2026-10-29", siteVisitDate: null }, DEFAULT_DEADLINE_RULES, bds);

  it("10. 變更會議日期後，未完成工作更新期限", () => {
    const changes = diffSchedule([base({})], computed);
    const c = changes.find((x) => x.taskType === "REVIEW_MINUTES_EMAIL")!;
    expect(c).toMatchObject({ action: "UPDATE", previousDate: "2026-10-23", newDate: "2026-10-30" });
  });

  it("11. 已完成工作保留紀錄，不會被重設", () => {
    const changes = diffSchedule([base({ status: "COMPLETED" })], computed);
    expect(changes.find((x) => x.taskType === "REVIEW_MINUTES_EMAIL")).toMatchObject({ action: "SKIP_COMPLETED", newDate: "2026-10-23" });
  });

  it("人工鎖定之期限不被更新", () => {
    const changes = diffSchedule([base({ overrideDueDate: "2026-10-26" })], computed);
    expect(changes.find((x) => x.taskType === "REVIEW_MINUTES_EMAIL")?.action).toBe("SKIP_LOCKED");
  });

  it("避免重複建立：已存在之工作不會再新建", () => {
    const changes = diffSchedule([base({})], computed);
    expect(changes.filter((x) => x.taskType === "REVIEW_MINUTES_EMAIL")).toHaveLength(1);
    expect(changes.filter((x) => x.action === "CREATE").map((x) => x.taskType)).not.toContain("REVIEW_MINUTES_EMAIL");
  });
});
