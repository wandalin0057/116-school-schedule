import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { CalendarImportForm, OverrideForm, RemoveOverrideButton } from "@/components/settings/calendar-admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireAdminPage } from "@/lib/auth";
import { dbDateToISO, formatROCDateTime, formatROCShort, taipeiToday, yearOf } from "@/lib/dates";
import { getCalendarOverview } from "@/server/business-days/calendar-admin-service";

export const metadata = { title: "工作天設定" };

export default async function CalendarSettingsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdminPage();
  const { years, overrides, days } = await getCalendarOverview();
  const sp = await searchParams;
  const thisYear = yearOf(taipeiToday());
  const selectedYear = Number(sp.year) || years[0]?.year || thisYear;
  const missingYears = [thisYear, thisYear + 1].filter((y) => !years.find((c) => c.year === y && c.isComplete));
  const yearDays = days.filter((d) => d.year === selectedYear);

  return (
    <>
      <PageHeader
        title="工作天設定"
        description="工作天計算排除週末與官方公告休假日、納入補行上班日。系統不自行猜測未公告假日；未匯入完整年度日曆者期限一律標示「暫估」。"
        actions={
          <Link href="/settings/recalculate" className="text-sm text-primary hover:underline">
            前往期限重新計算 →
          </Link>
        }
      />
      {missingYears.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          尚未匯入完整官方辦公日曆之年度：{missingYears.map((y) => `${y}（民國 ${y - 1911}）年`).join("、")}。相關期限為暫估；請於人事行政總處公告後匯入。
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>已匯入年度</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>年度</TH>
                  <TH>狀態</TH>
                  <TH>來源</TH>
                  <TH>匯入</TH>
                </TR>
              </THead>
              <TBody>
                {years.map((y) => (
                  <TR key={y.year}>
                    <TD>
                      <Link href={`/settings/calendar?year=${y.year}`} className="text-primary hover:underline">
                        {y.year}（民國 {y.year - 1911}）
                      </Link>
                    </TD>
                    <TD>
                      <Badge variant={y.isComplete ? "success" : "warning"}>{y.isComplete ? "完整" : "非完整（暫估）"}</Badge>
                    </TD>
                    <TD className="max-w-xs text-xs">{y.source}</TD>
                    <TD className="whitespace-nowrap text-xs">
                      {formatROCDateTime(y.importedAt)}
                      <br />
                      {y.importedBy?.name ?? "系統初始化"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {selectedYear}（民國 {selectedYear - 1911}）年 非上班日與補行上班日
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[360px] overflow-y-auto p-0">
            {yearDays.length ? (
              <Table>
                <TBody>
                  {yearDays.map((d) => (
                    <TR key={d.id}>
                      <TD className="whitespace-nowrap tabular">{formatROCShort(dbDateToISO(d.date))}</TD>
                      <TD>
                        <Badge variant={d.kind === "HOLIDAY" ? "danger" : "info"}>{d.kind === "HOLIDAY" ? "放假" : "補行上班"}</Badge>
                      </TD>
                      <TD className="text-sm">{d.description}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="p-4 text-sm text-muted-foreground">此年度尚無資料。</p>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>匯入官方辦公日曆</CardTitle>
            <p className="text-sm text-muted-foreground">
              請自政府資料開放平臺下載「中華民國政府行政機關辦公日曆表」CSV（欄位：西元日期、星期、是否放假、備註），或使用 JSON 格式。匯入前會先顯示期限差異預覽。
            </p>
          </CardHeader>
          <CardContent>
            <CalendarImportForm />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>手動調整（休假日／補行上班日）</CardTitle>
            <p className="text-sm text-muted-foreground">例如颱風停止上班。新增或刪除後，所有進行中案件的期限會自動重新計算（已完成、人工鎖定者不變）。手動調整優先於官方日曆，並記錄操作者、時間及原因。</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <OverrideForm />
            {overrides.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>日期</TH>
                    <TH>類型</TH>
                    <TH>原因</TH>
                    <TH>操作者</TH>
                    <TH>時間</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {overrides.map((o) => (
                    <TR key={o.id}>
                      <TD className="whitespace-nowrap tabular">{formatROCShort(dbDateToISO(o.date))}</TD>
                      <TD>
                        <Badge variant={o.kind === "HOLIDAY" ? "danger" : "info"}>{o.kind === "HOLIDAY" ? "休假日" : "補行上班"}</Badge>
                      </TD>
                      <TD className="text-sm">{o.reason}</TD>
                      <TD className="text-sm">{o.createdBy.name}</TD>
                      <TD className="whitespace-nowrap text-xs">{formatROCDateTime(o.updatedAt)}</TD>
                      <TD>
                        <RemoveOverrideButton id={o.id} label={`${formatROCShort(dbDateToISO(o.date))} ${o.reason}`} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
