// Public PDF layout for the student-facing exam handout.
// Keep reportPdfShared.js for common drawing primitives and context shaping.

const {
  PDF_PAGE,
  PDF_COLORS,
  SimplePdf,
  buildReportContext,
  drawSectionTitle,
  drawInfoCard,
  drawLinksBlock,
  drawStatCard,
} = require("./reportPdfShared");

function drawPublicHeader(doc, d, left, contentWidth) {
  doc.rect(left, 748, contentWidth, 70, PDF_COLORS.blue, null, 0);
  doc.text(left + 22, 792, `${d.module} - ${d.ref}`, { font: "F2", size: 22, color: PDF_COLORS.white });
  doc.text(left + 22, 772, `${d.wilaya} - Niveau ${d.level} - Session ${d.year}`, { font: "F1", size: 11, color: PDF_COLORS.white });
  doc.text(left + 22, 756, "Fiche publique de pratique et revision", { font: "F3", size: 8.5, color: PDF_COLORS.white });
}

function drawPublicOverviewSection(doc, d, left) {
  let y = 700;

  y = drawSectionTitle(doc, left, y, "Apercu de l examen");
  return drawInfoCard(doc, left, y, 470, "Resume etudiant", [
    { label: "Module", value: d.module },
    { label: "Reference", value: d.ref },
    { label: "Date", value: d.examDate },
    { label: "Questions disponibles", value: String(d.availableQuestions || d.totalQuestions || "-") },
    { label: "Corrige Type", value: d.hasCT ? "Inclus" : "Non indique" },
    { label: "Cas cliniques", value: d.hasCas ? "Oui" : "Non" },
  ], PDF_COLORS.blue);
}

function drawPublicStatsSection(doc, d, left) {
  let y = 510;

  y = drawSectionTitle(doc, left, y, "Points clefs");
  drawStatCard(doc, left, 484, 100, "Disponibles", String(d.availableQuestions || "-"), "Questions praticables", PDF_COLORS.green);
  drawStatCard(doc, left + 116, 484, 100, "Schemas", String(d.schemaQuestions.length), d.schemaQuestions.join(", ") || "Aucun", PDF_COLORS.amber);
  drawStatCard(doc, left + 232, 484, 100, "Cas", d.hasCas ? "Oui" : "Non", "Cas cliniques", PDF_COLORS.teal);
  drawStatCard(doc, left + 348, 484, 100, "CT", d.hasCT ? "Oui" : "Non", "Corrige type", PDF_COLORS.blue);
}

function drawPublicAccessSection(doc, d, left) {
  let y = 350;

  y = drawSectionTitle(doc, left, y, "Acces");
  return drawLinksBlock(doc, left, y, 470, "Lien public", [
    { label: "Quiz MBset", url: d.quizLink },
    { label: "CSV source", url: d.csvUrl },
  ]);
}

function drawPublicFooter(doc, d, left, right) {
  doc.line(left, 36, right, 36, PDF_COLORS.border, 1);
  doc.text(left, 22, `${d.module} - ${d.ref}`, { font: "F1", size: 8.5, color: PDF_COLORS.gray });
  doc.text(right - 145, 22, `Rapport public - ${d.year}`, { font: "F1", size: 8.5, color: PDF_COLORS.gray });
}

function buildPublicReportBuffer(input) {
  const d = buildReportContext(input);
  const doc = new SimplePdf();
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  const contentWidth = right - left;

  drawPublicHeader(doc, d, left, contentWidth);
  drawPublicOverviewSection(doc, d, left);
  drawPublicStatsSection(doc, d, left);
  drawPublicAccessSection(doc, d, left);
  drawPublicFooter(doc, d, left, right);

  return doc.toBuffer();
}

module.exports = {
  buildPublicReportBuffer,
};
