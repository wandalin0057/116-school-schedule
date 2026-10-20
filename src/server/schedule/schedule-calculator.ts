import type { DeadlineAnchor, TaskStatus, TaskType } from "@prisma/client";
import type { ISODate } from "@/lib/dates";
import type { BusinessDayService } from "@/server/business-days/business-day-service";
import type { DeadlineRuleDef } from "./deadline-rules";

/**
 * 期程計算（純函式）：由案件之通知日、審查會議日、會勘日與期限規則推算各工作期限。
 */

export interface ScheduleAnchors {
  notificationDate: ISODate | null;
  /** 審查會議之臺北日曆日 */
  reviewMeetingDate: ISODate | null;
  /** 會勘之臺北日曆日 */
  siteVisitDate: ISODate | null;
  /** 機關通知提送完整報告書日 */
  finalReportNoticeDate?: ISODate | null;
  /** 機關同意備查日 */
  finalReportApprovedDate?: ISODate | null;
}

export interface ComputedDeadline {
  taskType: TaskType;
  title: string;
  description: string;
  dueDate: ISODate | null;
  estimated: boolean;
  anchor: DeadlineAnchor;
  anchorDate: ISODate | null;
  offsetBusinessDays: number;
}

export interface CalculateOptions {
  /** 若某工作已人工鎖定期限，依附於該工作之規則改以鎖定日為基準（例如發文前一日創稿） */
  effectiveDueDates?: Partial<Record<TaskType, ISODate | null>>;
}

const ANCHOR_TASK: Partial<Record<DeadlineAnchor, TaskType>> = {
  PRE_REPORT_DISPATCH: "PRE_REPORT_DISPATCH",
};

export function calculateSchedule(
  anchors: ScheduleAnchors,
  rules: DeadlineRuleDef[],
  bds: BusinessDayService,
  options: CalculateOptions = {},
): ComputedDeadline[] {
  const enabled = rules.filter((r) => r.enabled);
  const results = new Map<TaskType, ComputedDeadline>();

  const baseAnchorDate = (anchor: DeadlineAnchor): ISODate | null => {
    switch (anchor) {
      case "NOTIFICATION_DATE":
        return anchors.notificationDate;
      case "REVIEW_MEETING":
        return anchors.reviewMeetingDate;
      case "SITE_VISIT":
        return anchors.siteVisitDate;
      case "FINAL_REPORT_NOTICE":
        return anchors.finalReportNoticeDate ?? null;
      case "FINAL_REPORT_APPROVED":
        return anchors.finalReportApprovedDate ?? null;
      default:
        return null;
    }
  };

  // 先計算以事件為基準之規則，再計算以其他工作為基準之規則
  const direct = enabled.filter((r) => !ANCHOR_TASK[r.anchor]);
  const dependent = enabled.filter((r) => ANCHOR_TASK[r.anchor]);

  for (const rule of direct) {
    const anchorDate = baseAnchorDate(rule.anchor);
    const res = anchorDate ? bds.addBusinessDays(anchorDate, rule.offsetBusinessDays) : null;
    results.set(rule.taskType, {
      taskType: rule.taskType,
      title: rule.title,
      description: rule.description,
      dueDate: res?.date ?? null,
      estimated: res?.estimated ?? false,
      anchor: rule.anchor,
      anchorDate,
      offsetBusinessDays: rule.offsetBusinessDays,
    });
  }

  for (const rule of dependent) {
    const anchorTask = ANCHOR_TASK[rule.anchor]!;
    const parent = results.get(anchorTask);
    const override = options.effectiveDueDates?.[anchorTask];
    let anchorDate: ISODate | null = override ?? parent?.dueDate ?? null;
    let parentEstimated = override ? false : parent?.estimated ?? false;
    // 若上游規則停用，仍依原始事件推算其期限作為基準
    if (!parent && !override && anchorTask === "PRE_REPORT_DISPATCH") {
      const dispatchRule = rules.find((r) => r.taskType === "PRE_REPORT_DISPATCH");
      const base = dispatchRule ? baseAnchorDate(dispatchRule.anchor) : null;
      if (dispatchRule && base) {
        const r = bds.addBusinessDays(base, dispatchRule.offsetBusinessDays);
        anchorDate = r.date;
        parentEstimated = r.estimated;
      }
    }
    const res = anchorDate ? bds.addBusinessDays(anchorDate, rule.offsetBusinessDays) : null;
    results.set(rule.taskType, {
      taskType: rule.taskType,
      title: rule.title,
      description: rule.description,
      dueDate: res?.date ?? null,
      estimated: (res?.estimated ?? false) || (res ? parentEstimated : false),
      anchor: rule.anchor,
      anchorDate,
      offsetBusinessDays: rule.offsetBusinessDays,
    });
  }

  const order = new Map(rules.map((r) => [r.taskType, r.sortOrder]));
  return [...results.values()].sort((a, b) => (order.get(a.taskType) ?? 0) - (order.get(b.taskType) ?? 0));
}

// ───────────────────────── 差異比對 ─────────────────────────

export interface ExistingTaskSnapshot {
  id: string;
  taskType: TaskType;
  title: string;
  status: TaskStatus;
  calculatedDueDate: ISODate | null;
  dueDateEstimated: boolean;
  overrideDueDate: ISODate | null;
}

export type ScheduleChangeAction =
  | "CREATE"          // 新建工作
  | "UPDATE"          // 更新期限
  | "UNCHANGED"       // 無變動
  | "SKIP_COMPLETED"  // 已完成／已取消，保留紀錄不變更
  | "SKIP_LOCKED"     // 已人工鎖定期限，不變更
  | "CLEAR";          // 基準日已移除，清除計算期限

export interface ScheduleChange {
  taskType: TaskType;
  title: string;
  taskId: string | null;
  action: ScheduleChangeAction;
  previousDate: ISODate | null;
  newDate: ISODate | null;
  estimated: boolean;
  status: TaskStatus | null;
  overrideDueDate: ISODate | null;
}

/**
 * 比對既有工作與新計算期限，產生異動清單。
 * 原則：
 *  1. 已完成（或取消）之工作保留原紀錄，不重設狀態、不改期限
 *  2. 已人工鎖定（overrideDueDate）之工作不變更
 *  3. 每種工作僅一筆，既有者更新、不存在且有期限者才新建（避免重複）
 */
export function diffSchedule(existing: ExistingTaskSnapshot[], computed: ComputedDeadline[]): ScheduleChange[] {
  const byType = new Map(existing.map((t) => [t.taskType, t]));
  const changes: ScheduleChange[] = [];
  for (const c of computed) {
    const task = byType.get(c.taskType);
    if (!task) {
      if (c.dueDate) {
        changes.push({
          taskType: c.taskType,
          title: c.title,
          taskId: null,
          action: "CREATE",
          previousDate: null,
          newDate: c.dueDate,
          estimated: c.estimated,
          status: null,
          overrideDueDate: null,
        });
      }
      continue;
    }
    const base = {
      taskType: c.taskType,
      title: task.title,
      taskId: task.id,
      previousDate: task.calculatedDueDate,
      estimated: c.estimated,
      status: task.status,
      overrideDueDate: task.overrideDueDate,
    };
    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      changes.push({ ...base, action: "SKIP_COMPLETED", newDate: task.calculatedDueDate, estimated: task.dueDateEstimated });
    } else if (task.overrideDueDate) {
      changes.push({ ...base, action: "SKIP_LOCKED", newDate: c.dueDate });
    } else if (task.calculatedDueDate === c.dueDate && task.dueDateEstimated === c.estimated) {
      changes.push({ ...base, action: "UNCHANGED", newDate: c.dueDate });
    } else if (c.dueDate === null) {
      changes.push({ ...base, action: "CLEAR", newDate: null });
    } else {
      changes.push({ ...base, action: "UPDATE", newDate: c.dueDate });
    }
  }
  return changes;
}

export function hasEffectiveChanges(changes: ScheduleChange[]): boolean {
  return changes.some((c) => c.action === "CREATE" || c.action === "UPDATE" || c.action === "CLEAR");
}
