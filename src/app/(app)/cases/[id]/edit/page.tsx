import { notFound, redirect } from "next/navigation";
import { CaseForm } from "@/components/cases/case-form";
import { caseToFormValues } from "@/components/cases/case-form-values";
import { PageHeader } from "@/components/common/page-header";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canAccessCase } from "@/server/auth/permissions";
import { listUsers } from "@/server/users/user-service";
import { listProjectNames } from "@/server/cases/projects";

export const metadata = { title: "編輯學校案件" };

export default async function EditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await canAccessCase(user, id, "edit"))) notFound();
  const [c, users, names] = await Promise.all([
    prisma.schoolCase.findUniqueOrThrow({ where: { id }, include: { responsibleUser: { select: { name: true, email: true } } } }),
    listUsers(),
    listProjectNames(),
  ]);
  if (c.caseType === "RESULT_VIDEO") redirect("/videos");
  return (
    <>
      <PageHeader title={`編輯案件：${c.schoolName}`} description={c.projectCode} />
      <CaseForm
        mode="edit"
        caseId={id}
        initial={caseToFormValues(c, { responsible: c.responsibleUser })}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
        canCreateResponsible={user.role === "ADMIN"}
        projectNames={names}
      />
    </>
  );
}
