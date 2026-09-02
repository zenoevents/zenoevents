/* Generates the downloadable PDF version of the Zeno system guide from the
   same content module the in-app /docs/guide page renders.
   Run: npx tsx scripts/generate-guide-pdf.tsx */
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToFile } from "@react-pdf/renderer";
import { GUIDE_META, GUIDE_SECTIONS as RAW_SECTIONS, ROLE_MATRIX, ROLE_LABELS, type GuideSection } from "../src/content/guide";
import path from "path";
import fs from "fs";

const SCREENSHOTS_DIR = path.join(process.cwd(), "public", "docs", "screenshots");

/** Helvetica (react-pdf's base14 font, no embedding needed) only supports
 *  WinAnsiEncoding — "→" isn't in it and silently renders as a stray glyph.
 *  Swapped for a plain arrow here only; the web page keeps the real glyph
 *  since browsers aren't limited to a base-14 font's encoding. */
function pdfSafe(text: string): string {
  return text.replace(/→/g, "->").replace(/•/g, "-");
}
function sanitizeSection(sec: GuideSection): GuideSection {
  return {
    ...sec,
    title: pdfSafe(sec.title),
    subtitle: sec.subtitle ? pdfSafe(sec.subtitle) : sec.subtitle,
    summary: pdfSafe(sec.summary),
    keyConcepts: sec.keyConcepts?.map(pdfSafe),
    steps: sec.steps?.map((st) => ({ title: pdfSafe(st.title), detail: pdfSafe(st.detail) })),
    note: sec.note ? pdfSafe(sec.note) : sec.note,
    screenshotCaption: sec.screenshotCaption ? pdfSafe(sec.screenshotCaption) : sec.screenshotCaption,
  };
}
const GUIDE_SECTIONS = RAW_SECTIONS.map(sanitizeSection);

const INK = "#1d1d1f";
const MUTED = "#6e6e73";
const FAINT = "#a1a1a6";
const HAIRLINE = "#e5e5ea";
const ACCENT = "#0f766e";
const ACCENT_SOFT = "#e6f2f0";
const PAPER = "#ffffff";
const SHADE = "#f5f5f7";

const s = StyleSheet.create({
  page: { paddingTop: 64, paddingBottom: 64, paddingHorizontal: 60, fontSize: 10.5, fontFamily: "Helvetica", color: INK, backgroundColor: PAPER },

  // Cover
  coverPage: { paddingTop: 0, paddingBottom: 0, paddingHorizontal: 0, backgroundColor: INK, color: "#fff" },
  coverInner: { flex: 1, justifyContent: "space-between", padding: 64 },
  coverEyebrow: { fontSize: 10, fontFamily: "Helvetica-Bold", letterSpacing: 2, color: "#8e8e93", textTransform: "uppercase" },
  coverTitle: { fontSize: 40, fontFamily: "Helvetica-Bold", marginTop: 18, lineHeight: 1.15, maxWidth: 420 },
  coverSubtitle: { fontSize: 13, color: "#c7c7cc", marginTop: 18, lineHeight: 1.5, maxWidth: 380 },
  coverFooterRule: { height: 1, backgroundColor: "#3a3a3c", marginBottom: 14 },
  coverFooterRow: { flexDirection: "row", justifyContent: "space-between" },
  coverFooterText: { fontSize: 9, color: "#8e8e93" },

  // Shared eyebrow / heading system
  eyebrow: { fontSize: 8.5, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, color: MUTED, textTransform: "uppercase", marginBottom: 6 },
  h1: { fontSize: 22, fontFamily: "Helvetica-Bold", letterSpacing: -0.3 },
  h2: { fontSize: 15, fontFamily: "Helvetica-Bold", letterSpacing: -0.2 },

  // TOC
  tocRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  tocNum: { width: 28, fontSize: 10, fontFamily: "Helvetica-Bold", color: ACCENT },
  tocTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  tocSubtitle: { fontSize: 9, color: MUTED, marginTop: 1 },

  // Role matrix
  matrixHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6, marginBottom: 2 },
  matrixRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: HAIRLINE, paddingVertical: 5, alignItems: "center" },
  matrixModuleCol: { width: 130, fontSize: 8, fontFamily: "Helvetica-Bold" },
  matrixRoleCol: { flex: 1, alignItems: "center" },
  matrixDot: { width: 5, height: 5, borderRadius: 2.5 },
  matrixRoleHeader: { flex: 1, textAlign: "center", fontSize: 6.3, fontFamily: "Helvetica-Bold", color: MUTED },

  // Section
  sectionWrap: { marginBottom: 22 },
  sectionHeadRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  sectionBadge: { width: 30, height: 30, borderRadius: 8, backgroundColor: INK, color: "#fff", fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 8, marginRight: 12 },
  sectionTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 9.5, color: MUTED, marginTop: 1 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6, gap: 4 },
  tag: { fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTED, backgroundColor: SHADE, borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 7, textTransform: "uppercase", letterSpacing: 0.4 },

  summary: { fontSize: 10.5, lineHeight: 1.55, color: "#2c2c2e", marginTop: 4 },
  rolesLine: { fontSize: 8.5, color: MUTED, marginTop: 6 },
  rolesLineLabel: { fontFamily: "Helvetica-Bold", color: "#48484a" },

  previewBox: { marginTop: 12, borderWidth: 1, borderColor: HAIRLINE, borderStyle: "dashed", borderRadius: 8, backgroundColor: SHADE, padding: 12, flexDirection: "row", alignItems: "center" },
  previewIcon: { width: 24, height: 24, borderRadius: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: HAIRLINE, marginRight: 10 },
  previewEyebrow: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: FAINT, textTransform: "uppercase", letterSpacing: 0.6 },
  previewText: { fontSize: 9.5, color: "#3a3a3c", marginTop: 2 },

  screenshotWrap: { marginTop: 12, marginBottom: 4 },
  screenshotImg: { width: "100%", maxHeight: 230, objectFit: "cover", objectPosition: "top", borderRadius: 6, borderWidth: 1, borderColor: HAIRLINE },
  screenshotCaption: { fontSize: 8.3, color: MUTED, marginTop: 5 },

  blockLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: MUTED, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  bullet: { flexDirection: "row", marginBottom: 4 },
  bulletMark: { width: 10, fontSize: 9.5, color: FAINT },
  bulletText: { flex: 1, fontSize: 9.5, lineHeight: 1.5, color: "#2c2c2e" },

  step: { flexDirection: "row", marginBottom: 8 },
  stepNum: { width: 16, height: 16, borderRadius: 8, backgroundColor: ACCENT_SOFT, color: ACCENT, fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 3.5, marginRight: 8 },
  stepTitle: { fontSize: 9.8, fontFamily: "Helvetica-Bold", color: INK },
  stepDetail: { fontSize: 9.2, color: MUTED, marginTop: 1.5, lineHeight: 1.45 },

  note: { marginTop: 14, backgroundColor: "#fff8ec", borderLeftWidth: 2.5, borderLeftColor: "#d9a441", borderRadius: 4, padding: 10 },
  noteLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#8a5a12", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  noteText: { fontSize: 9.3, color: "#5c4009", lineHeight: 1.5 },

  crossRefWrap: { marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: HAIRLINE, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  crossRefLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: FAINT, textTransform: "uppercase", letterSpacing: 0.6, marginRight: 2 },
  crossRefChip: { fontSize: 8.3, color: ACCENT, backgroundColor: ACCENT_SOFT, borderRadius: 8, paddingVertical: 2.5, paddingHorizontal: 7 },

  hr: { height: 1, backgroundColor: HAIRLINE, marginVertical: 20 },

  footer: { position: "absolute", bottom: 30, left: 60, right: 60, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: FAINT },
});

function Footer({ pageLabel }: { pageLabel: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{GUIDE_META.title}</Text>
      <Text>{pageLabel}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

function SectionBlock({ section }: { section: GuideSection }) {
  return (
    <View style={s.sectionWrap} wrap>
      <View style={s.sectionHeadRow}>
        <Text style={s.sectionBadge}>{section.number}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.sectionTitle}>{section.title}</Text>
          {section.subtitle && <Text style={s.sectionSubtitle}>{section.subtitle}</Text>}
          <View style={s.tagRow}>
            {section.tags.map((t) => <Text key={t} style={s.tag}>{t}</Text>)}
          </View>
        </View>
      </View>

      <Text style={s.summary}>{section.summary}</Text>
      <Text style={s.rolesLine}><Text style={s.rolesLineLabel}>Roles  </Text>{section.roles.join("   ·   ")}</Text>

      {section.screenshot && fs.existsSync(path.join(SCREENSHOTS_DIR, section.screenshot)) ? (
        <View style={s.screenshotWrap} wrap={false}>
          <Image src={path.join(SCREENSHOTS_DIR, section.screenshot)} style={s.screenshotImg} />
          {section.screenshotCaption && <Text style={s.screenshotCaption}>{section.screenshotCaption}</Text>}
        </View>
      ) : (
        section.screenshotCaption && (
          <View style={s.previewBox}>
            <View style={s.previewIcon} />
            <View style={{ flex: 1 }}>
              <Text style={s.previewEyebrow}>Preview this screen live in the app</Text>
              <Text style={s.previewText}>{section.screenshotCaption}</Text>
            </View>
          </View>
        )
      )}

      {section.keyConcepts && section.keyConcepts.length > 0 && (
        <View>
          <Text style={s.blockLabel}>Key concepts</Text>
          {section.keyConcepts.map((c, i) => (
            <View key={i} style={s.bullet}>
              <Text style={s.bulletMark}>—</Text>
              <Text style={s.bulletText}>{c}</Text>
            </View>
          ))}
        </View>
      )}

      {section.steps && section.steps.length > 0 && (
        <View>
          <Text style={s.blockLabel}>Step by step</Text>
          {section.steps.map((step, i) => (
            <View key={i} style={s.step}>
              <Text style={s.stepNum}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{step.title}</Text>
                <Text style={s.stepDetail}>{step.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {section.note && (
        <View style={s.note}>
          <Text style={s.noteLabel}>Note</Text>
          <Text style={s.noteText}>{section.note}</Text>
        </View>
      )}

      {section.crossRefs && section.crossRefs.length > 0 && (
        <View style={s.crossRefWrap}>
          <Text style={s.crossRefLabel}>See also</Text>
          {section.crossRefs.map((ref) => (
            <Text key={ref} style={s.crossRefChip}>{ref}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function GuideDocument() {
  const generatedOn = new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Document title={GUIDE_META.title} author="Zeno Events">
      {/* Cover */}
      <Page size="A4" style={s.coverPage}>
        <View style={s.coverInner}>
          <View>
            <Text style={s.coverEyebrow}>Zeno Events · System Guide</Text>
            <Text style={s.coverTitle}>{GUIDE_META.subtitle}</Text>
            <Text style={s.coverSubtitle}>
              Every module, every role, from a lead's first message to a fully reconciled, fully paid, fully signed event — written for event companies running their whole business on Zeno.
            </Text>
          </View>
          <View>
            <View style={s.coverFooterRule} />
            <View style={s.coverFooterRow}>
              <Text style={s.coverFooterText}>Version {GUIDE_META.version}</Text>
              <Text style={s.coverFooterText}>Generated {generatedOn}</Text>
            </View>
          </View>
        </View>
      </Page>

      {/* Table of contents */}
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Contents</Text>
        <Text style={s.h1}>Everything in this guide</Text>
        <View style={{ marginTop: 20 }}>
          {GUIDE_SECTIONS.map((sec) => (
            <View key={sec.number} style={s.tocRow}>
              <Text style={s.tocNum}>{sec.number}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.tocTitle}>{sec.title}</Text>
                {sec.subtitle && <Text style={s.tocSubtitle}>{sec.subtitle}</Text>}
              </View>
            </View>
          ))}
        </View>
        <Footer pageLabel="Contents" />
      </Page>

      {/* Role matrix */}
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>Quick reference</Text>
        <Text style={s.h1}>Who sees what, by default</Text>
        <Text style={{ fontSize: 9.5, color: MUTED, marginTop: 8, lineHeight: 1.5, maxWidth: 440 }}>
          Every role has a fixed list of modules it can see out of the box. An admin can adjust any of this per organization — see Section 19.
        </Text>

        <View style={{ marginTop: 22 }}>
          <View style={s.matrixHeaderRow}>
            <Text style={s.matrixModuleCol}> </Text>
            {Object.values(ROLE_LABELS).map((label) => (
              <Text key={label} style={s.matrixRoleHeader}>{label}</Text>
            ))}
          </View>
          {ROLE_MATRIX.map((row) => (
            <View key={row.module} style={s.matrixRow} wrap={false}>
              <Text style={s.matrixModuleCol}>{row.module}</Text>
              {Object.keys(ROLE_LABELS).map((key) => (
                <View key={key} style={s.matrixRoleCol}>
                  {row.roles.includes(key) ? (
                    <View style={[s.matrixDot, { backgroundColor: ACCENT }]} />
                  ) : (
                    <View style={[s.matrixDot, { backgroundColor: "#e5e5ea" }]} />
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
        <Footer pageLabel="Roles & Access" />
      </Page>

      {/* Sections, grouped a few per page by natural flow */}
      <Page size="A4" style={s.page}>
        {GUIDE_SECTIONS.map((sec, i) => (
          <React.Fragment key={sec.number}>
            <SectionBlock section={sec} />
            {i < GUIDE_SECTIONS.length - 1 && <View style={s.hr} />}
          </React.Fragment>
        ))}
        <Footer pageLabel="Reference" />
      </Page>
    </Document>
  );
}

async function main() {
  const outPath = path.join(process.cwd(), "public", "zeno-system-guide.pdf");
  await renderToFile(<GuideDocument />, outPath);
  console.log(`Guide PDF written to ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("PDF generation failed:", e);
  process.exit(1);
});
