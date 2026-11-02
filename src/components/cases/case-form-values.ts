import { dbDateToISOOrNull, toTaipeiDateTimeInput } from "@/lib/dates";
import { DEFAULT_PROJECT_NAME } from "@/server/cases/case-schema";

type CaseRow = {
  projectCode: string;
  projectName: string;
  schoolName: string;
  district: string | null;
  agencyName: string | null;
  agencyContact: string | null;
  agencyEmail: string | null;
  responsibleUserId: string;
  notificationDate: Date | null;
  notificationRound?: number | null;
  reviewMeetingDateTime: Date | null;
  reviewMeetingLocation: string | null;
  siteVisitDateTime: Date | null;
  siteVisitLocation: string | null;
  siteVisitUploadUrl: string | null;
  finalReportNoticeDate?: Date | null;
  finalReportApprovedDate?: Date | null;
  status: string;
  notes: string | null;
};

export function caseToFormValues(
  c: CaseRow | null,
  defaults: { responsible?: { name: string; email: string } | null; projectName?: string },
) {
  return {
    projectCode: c?.projectCode ?? "",
    projectName: c?.projectName ?? defaults.projectName ?? DEFAULT_PROJECT_NAME,
    schoolName: c?.schoolName ?? "",
    district: c?.district ?? "",
    agencyName: c?.agencyName ?? "臺北市政府交通局",
    agencyContact: c?.agencyContact ?? "",
    agencyEmail: c?.agencyEmail ?? "",
    responsibleUserId: "",
    responsibleName: defaults.responsible?.name ?? "",
    responsibleEmail: defaults.responsible?.email ?? "",
    notificationDate: dbDateToISOOrNull(c?.notificationDate) ?? "",
    notificationRound: c?.notificationRound ? String(c.notificationRound) : "",
    reviewMeetingDateTime: toTaipeiDateTimeInput(c?.reviewMeetingDateTime),
    reviewMeetingLocation: c?.reviewMeetingLocation ?? "",
    siteVisitDateTime: toTaipeiDateTimeInput(c?.siteVisitDateTime),
    siteVisitLocation: c?.siteVisitLocation ?? "",
    siteVisitUploadUrl: c?.siteVisitUploadUrl ?? "",
    finalReportNoticeDate: dbDateToISOOrNull(c?.finalReportNoticeDate) ?? "",
    finalReportApprovedDate: dbDateToISOOrNull(c?.finalReportApprovedDate) ?? "",
    status: c?.status ?? "ACTIVE",
    notes: c?.notes ?? "",
    dateChangeReason: "",
  };
}
