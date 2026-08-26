import { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { getContractForPdf } from "@/lib/contracts";
import { ContractPdf } from "@/lib/pdf/ContractPdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let o;
  try {
    await requirePerm("contracts");
    o = await getOrg();
  } catch {
    return new Response("Sign in required", { status: 401 });
  }

  const contract = await getContractForPdf(Number(id));
  if (!contract) return new Response("Not found", { status: 404 });

  const element = React.createElement(ContractPdf, {
    data: {
      orgName: o.name,
      brandColor: o.brandColor ?? "#0f766e",
      id: contract.id,
      subject: contract.subject,
      projectName: contract.projectName,
      clientName: contract.clientName,
      clientPhone: contract.clientPhone,
      clientEmail: contract.clientEmail,
      valueCents: contract.valueCents,
      startDate: contract.startDate,
      endDate: contract.endDate,
      content: contract.content,
      status: contract.status,
      signedAt: contract.signedAt,
      signedByName: contract.signedByName,
    },
  });

  const buffer = await renderToBuffer(element as React.ReactElement<import("@react-pdf/renderer").DocumentProps>);

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `Contract_${contract.id}_${contract.subject.replace(/\s+/g, "_")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
}
