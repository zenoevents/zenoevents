import React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { fmtKES } from "@/lib/money";

/** Full date + time, not just the day — "signed on Sep 1" isn't enough of
 *  a record; the exact moment matters for a signed contract. */
function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-KE", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export interface PdfContractData {
  orgName: string;
  brandColor: string;
  id: number;
  subject: string;
  projectName: string;
  clientName: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  valueCents: number;
  startDate: string;
  endDate: string | null;
  content: string | null;
  paymentTerms: string | null;
  contractTypeName: string | null;
  status: string;
  signedAt: string | null;
  signedByName: string | null;
  signatureMethod: string | null;
  /** Signed, time-limited URL to the uploaded wet-ink photo — resolved by
   *  the caller (route handler) before render, since ContractPdf itself has
   *  no storage access. Only present when signatureMethod is wet_ink. */
  signaturePhotoUrl: string | null;
}

function makeStyles(brand: string) {
  return StyleSheet.create({
    page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#1d1d1f" },
    header: { marginBottom: 32, borderBottomWidth: 1, borderBottomColor: brand, paddingBottom: 16 },
    orgName: { fontSize: 18, fontFamily: "Helvetica-Bold", color: brand },
    title: { fontSize: 14, marginTop: 4, color: "#6e6e73" },

    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 8, color: brand },

    grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 16 },
    gridItem: { width: "50%", paddingBottom: 8 },
    label: { color: "#6e6e73" },
    value: { fontFamily: "Helvetica-Bold", marginTop: 2 },

    body: { lineHeight: 1.5 },

    signatureBox: { marginTop: 8, borderWidth: 1, borderColor: "#e8e8ed", borderRadius: 4, padding: 12 },
    signed: { color: "#1f8a4c", fontFamily: "Helvetica-Bold" },
    unsigned: { color: "#86868b" },
    signatureName: { fontSize: 22, fontFamily: "Times-Italic", marginTop: 6, marginBottom: 2 },
    signaturePhoto: { maxWidth: 220, maxHeight: 100, marginTop: 6, marginBottom: 2, objectFit: "contain" },
    signatureMeta: { fontSize: 9, color: "#6e6e73", marginTop: 2 },

    footer: { position: "absolute", bottom: 48, left: 48, right: 48, fontSize: 8, color: "#86868b", textAlign: "center" },
  });
}

export function ContractPdf({ data }: { data: PdfContractData }) {
  const s = makeStyles(data.brandColor || "#0f766e");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.orgName}>{data.orgName}</Text>
          <Text style={s.title}>{data.subject}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Agreement details</Text>
          <View style={s.grid}>
            <View style={s.gridItem}>
              <Text style={s.label}>Event / Project:</Text>
              <Text style={s.value}>{data.projectName}</Text>
            </View>
            <View style={s.gridItem}>
              <Text style={s.label}>Client:</Text>
              <Text style={s.value}>{data.clientName || "—"}</Text>
            </View>
            <View style={s.gridItem}>
              <Text style={s.label}>Contract Value:</Text>
              <Text style={s.value}>{fmtKES(data.valueCents)}</Text>
            </View>
            {data.contractTypeName && (
              <View style={s.gridItem}>
                <Text style={s.label}>Contract Type:</Text>
                <Text style={s.value}>{data.contractTypeName}</Text>
              </View>
            )}
            <View style={s.gridItem}>
              <Text style={s.label}>Start Date:</Text>
              <Text style={s.value}>{data.startDate}</Text>
            </View>
            {data.endDate && (
              <View style={s.gridItem}>
                <Text style={s.label}>End Date:</Text>
                <Text style={s.value}>{data.endDate}</Text>
              </View>
            )}
            {(data.clientPhone || data.clientEmail) && (
              <View style={s.gridItem}>
                <Text style={s.label}>Contact:</Text>
                <Text style={s.value}>{[data.clientPhone, data.clientEmail].filter(Boolean).join(" · ")}</Text>
              </View>
            )}
          </View>
        </View>

        {data.content && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Terms</Text>
            <Text style={s.body}>{data.content}</Text>
          </View>
        )}

        {data.paymentTerms && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Payment Terms</Text>
            <Text style={s.body}>{data.paymentTerms}</Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Signature</Text>
          <View style={s.signatureBox}>
            {data.status === "signed" ? (
              <>
                <Text style={s.signed}>Signed</Text>
                {data.signaturePhotoUrl ? (
                  <Image src={data.signaturePhotoUrl} style={s.signaturePhoto} />
                ) : (
                  <Text style={s.signatureName}>{data.signedByName}</Text>
                )}
                <Text style={s.signatureMeta}>
                  {data.signedByName}{data.signedAt ? ` · ${formatSignedAt(data.signedAt)}` : ""}
                  {data.signatureMethod === "portal_click" ? " · Signed electronically via client portal" : data.signaturePhotoUrl ? " · Signed copy uploaded by staff" : ""}
                </Text>
              </>
            ) : (
              <Text style={s.unsigned}>Not yet signed</Text>
            )}
          </View>
        </View>

        <Text style={s.footer}>Contract #{data.id} · Generated on {new Date().toLocaleDateString()}</Text>
      </Page>
    </Document>
  );
}
