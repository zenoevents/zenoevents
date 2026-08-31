import { NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { db, contracts, projects, contacts } from "@/db";
import { and, eq } from "drizzle-orm";
import { getClientSession } from "@/lib/client-portal/auth";
import { ContractPdf } from "@/lib/pdf/ContractPdf";
import { contentDisposition } from "@/lib/pdf-filename";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await ctx.params;
  const session = await getClientSession(orgSlug);
  if (!session) return new Response("Sign in required", { status: 401 });

  const o = session.org;

  const [row] = await db
    .select({ contract: contracts, projectContactId: projects.contactId, projectName: projects.name, clientId: contacts.id, clientName: contacts.displayName, clientPhone: contacts.phone, clientEmail: contacts.email })
    .from(contracts)
    .innerJoin(projects, eq(projects.id, contracts.projectId))
    .leftJoin(contacts, eq(contacts.id, projects.contactId))
    .where(and(eq(contracts.orgId, session.orgId), eq(contracts.id, Number(id))))
    .limit(1);

  if (!row || row.projectContactId !== session.contactId) return new Response("Not found", { status: 404 });
  const contract = row.contract;

  const element = React.createElement(ContractPdf, {
    data: {
      orgName: o.name,
      brandColor: o.brandColor ?? "#0f766e",
      id: contract.id,
      subject: contract.subject,
      projectName: row.projectName,
      clientName: row.clientName ?? "",
      clientPhone: row.clientPhone,
      clientEmail: row.clientEmail,
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
  const rawFilename = `Contract_${contract.id}_${contract.subject.replace(/\s+/g, "_")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", rawFilename, `Contract_${contract.id}.pdf`),
    },
  });
}
