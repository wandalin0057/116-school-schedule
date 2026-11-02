import { prisma } from "@/lib/db";
import { caseAccessWhere } from "@/server/auth/permissions";
import type { AuthUser } from "@/server/auth/types";

/** 預設計畫（年度新案可直接在新增案件時輸入，之後會自動出現在清單） */
export const PRESET_PROJECTS = ["116年度臺北市通學區規劃分析案", "115年度臺北市通學區規劃分析案"] as const;

const yearOf = (name: string) => Number(/^(\d{2,3})年度/.exec(name)?.[1] ?? 0);

/** 計畫名稱排序：年度新的在前 */
export function sortProjects(names: Iterable<string>): string[] {
  return [...new Set(names)].sort((a, b) => yearOf(b) - yearOf(a) || a.localeCompare(b, "zh-Hant"));
}

/** 簡短標籤：「116年度臺北市通學區規劃分析案」→「116年度」 */
export function shortProjectLabel(name: string): string {
  const m = /^(\d{2,3}年度)/.exec(name);
  return m ? m[1] : name.length > 10 ? `${name.slice(0, 10)}…` : name;
}

/** 可選擇之計畫清單（預設計畫＋資料庫中已使用者） */
export async function listProjectNames(user?: AuthUser): Promise<string[]> {
  const rows = await prisma.schoolCase.findMany({
    where: { AND: [user ? caseAccessWhere(user) : {}, { caseType: "SCHOOL_ZONE" }] },
    distinct: ["projectName"],
    select: { projectName: true },
  });
  return sortProjects([...PRESET_PROJECTS, ...rows.map((r) => r.projectName)]);
}

/** 各計畫案件數（案件列表分頁使用） */
export async function countCasesByProject(user: AuthUser) {
  const rows = await prisma.schoolCase.groupBy({ by: ["projectName"], where: { AND: [caseAccessWhere(user), { caseType: "SCHOOL_ZONE" }] }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.projectName, r._count._all]));
}
