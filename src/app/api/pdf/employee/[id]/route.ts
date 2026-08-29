import { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { db, employees, loanLedger, payrollRunLineItems, payrollRuns } from "@/db";
import { and, eq, desc } from "drizzle-orm";
import { getOrg } from "@/lib/org";
import { EmployeePdf } from "@/lib/pdf/EmployeePdf";
import { contentDisposition } from "@/lib/pdf-filename";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let o;
  try {
    o = await getOrg();
  } catch {
    return new Response("Sign in required", { status: 401 });
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, Number(id)), eq(employees.orgId, o.id)))
    .limit(1);

  if (!employee) return new Response("Not found", { status: 404 });

  const loans = await db
    .select()
    .from(loanLedger)
    .where(and(eq(loanLedger.employeeId, employee.id), eq(loanLedger.orgId, o.id)))
    .orderBy(desc(loanLedger.createdAt));

  const payslips = await db
    .select({
      month: payrollRuns.month,
      runId: payrollRuns.id,
      grossPay: payrollRunLineItems.amountCents,
    })
    .from(payrollRunLineItems)
    .innerJoin(payrollRuns, eq(payrollRunLineItems.payrollRunId, payrollRuns.id))
    .where(and(
      eq(payrollRunLineItems.employeeId, employee.id),
      eq(payrollRunLineItems.type, "gross_pay")
    ))
    .orderBy(desc(payrollRuns.month));

  const element = React.createElement(EmployeePdf, {
    data: {
      orgName: o.name,
      brandColor: o.brandColor ?? "#0f766e",
      employeeName: employee.name,
      basicSalaryCents: employee.basicSalaryCents,
      kraPin: employee.kraPin,
      nssfNumber: employee.nssfNumber,
      shifNumber: employee.shifNumber,
      isActive: employee.isActive,
      createdAt: employee.createdAt.slice(0, 10),
      loans: loans.map(l => ({
        createdAt: l.createdAt,
        principalCents: l.principalCents,
        balanceCents: l.balanceCents,
        status: l.status,
      })),
      payslips: payslips.map(p => ({
        month: p.month,
        grossPayCents: p.grossPay,
      })),
    }
  });

  const buffer = await renderToBuffer(element as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `Employee_${employee.name.replace(/\s+/g, "_")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", filename, `Employee_${employee.id}.pdf`),
    },
  });
}
