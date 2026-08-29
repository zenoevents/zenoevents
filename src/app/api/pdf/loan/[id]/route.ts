import { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { db, employees, loanLedger, loanInstallments, payrollRuns } from "@/db";
import { and, eq, asc } from "drizzle-orm";
import { getOrg } from "@/lib/org";
import { LoanPdf } from "@/lib/pdf/LoanPdf";
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

  const [loan] = await db
    .select({
      id: loanLedger.id,
      principalCents: loanLedger.principalCents,
      balanceCents: loanLedger.balanceCents,
      status: loanLedger.status,
      createdAt: loanLedger.createdAt,
      employeeName: employees.name,
      employeeId: employees.id,
    })
    .from(loanLedger)
    .innerJoin(employees, eq(loanLedger.employeeId, employees.id))
    .where(and(eq(loanLedger.id, Number(id)), eq(loanLedger.orgId, o.id)))
    .limit(1);

  if (!loan) return new Response("Not found", { status: 404 });

  const installments = await db
    .select({
      id: loanInstallments.id,
      amountCents: loanInstallments.amountCents,
      payrollRunId: loanInstallments.payrollRunId,
      month: payrollRuns.month,
      createdAt: loanInstallments.createdAt,
    })
    .from(loanInstallments)
    .innerJoin(payrollRuns, eq(loanInstallments.payrollRunId, payrollRuns.id))
    .where(eq(loanInstallments.loanId, loan.id))
    .orderBy(asc(loanInstallments.createdAt));

  const totalPaid = loan.principalCents - loan.balanceCents;
  const remainingBalance = loan.balanceCents;

  const element = React.createElement(LoanPdf, {
    data: {
      orgName: o.name,
      brandColor: o.brandColor ?? "#0f766e",
      employeeName: loan.employeeName,
      loanId: loan.id,
      principalCents: loan.principalCents,
      status: loan.status,
      createdAt: loan.createdAt,
      totalPaid,
      remainingBalance,
      installments: installments.map(i => ({
        month: i.month,
        amountCents: i.amountCents,
      }))
    }
  });

  const buffer = await renderToBuffer(element as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `Loan_Statement_${loan.id}_${loan.employeeName.replace(/\s+/g, "_")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", filename, `Loan_Statement_${loan.id}.pdf`),
    },
  });
}
