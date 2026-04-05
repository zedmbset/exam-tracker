// Admin PDF layout for the internal exam report.
// Keep reportPdfShared.js for common drawing primitives and context shaping.

const {
  PDF_PAGE,
  PDF_COLORS,
  SimplePdf,
  buildReportContext,
  drawBadge,
  drawSectionTitle,
  drawInfoCard,
  drawLinksBlock,
  drawStatCard,
} = require("./reportPdfShared");

function drawAdminHeader(doc, d, left, contentWidth) {
  let badgeX = left;

  doc.rect(left, 748, contentWidth, 70, PDF_COLORS.teal, null, 0);
  doc.rect(left, 748, 10, 70, PDF_COLORS.tealDark, null, 0);
  doc.text(left + 22, 792, `${d.module} - ${d.ref}`, { font: "F2", size: 22, color: PDF_COLORS.white });
  doc.text(left + 22, 772, `${d.wilaya} - Niveau ${d.level} - Annee ${d.year} - Examen du ${d.examDate}`, { font: "F1", size: 10.5, color: PDF_COLORS.white });
  doc.text(left + 22, 756, "Rapport administratif genere automatiquement", { font: "F3", size: 8.5, color: PDF_COLORS.tealLight });

  badgeX = drawBadge(doc, badgeX, 725, d.status, d.status.toLowerCase().includes("completed") ? PDF_COLORS.green : PDF_COLORS.amber);
  badgeX = drawBadge(doc, badgeX, 725, d.hasCT ? "CT" : "No CT", d.hasCT ? PDF_COLORS.blue : PDF_COLORS.gray);
  badgeX = drawBadge(doc, badgeX, 725, d.hasCas ? "Cas cliniques" : "Sans cas", d.hasCas ? PDF_COLORS.teal : PDF_COLORS.gray);
  drawBadge(doc, badgeX, 725, d.hasComb ? "Associations" : "QCM standard", d.hasComb ? PDF_COLORS.amber : PDF_COLORS.gray);
}

function drawAdminIdentitySection(doc, d, left) {
  let y = 690;

  y = drawSectionTitle(doc, left, y, "Identite de l examen");
  y = drawInfoCard(doc, left, y, 250, "Informations generales", [
    { label: "Module", value: d.module },
    { label: "Wilaya", value: d.wilaya },
    { label: "Annee", value: d.year },
    { label: "Niveau", value: d.level },
    { label: "Reference", value: d.ref },
    { label: "Membre", value: d.member },
  ], PDF_COLORS.teal);

  const rightTop = 666;
  drawStatCard(doc, 320, rightTop, 90, "Questions", String(d.totalQuestions || "-"), `${d.availableQuestions} disponibles`, PDF_COLORS.teal);
  drawStatCard(doc, 420, rightTop, 90, "Manquantes", String(d.missingCount), d.missingPositions.join(", ") || "Aucune", d.missingCount ? PDF_COLORS.red : PDF_COLORS.green);

  return y;
}

function drawAdminQualitySection(doc, d, left) {
  let y = 538;

  y = drawSectionTitle(doc, left, y, "Qualite de numerisation");
  return drawInfoCard(doc, left, y, 470, "Controle de compatibilite", [
    { label: "Corrige Type", value: d.hasCT ? "Present" : "Absent" },
    { label: "Cas cliniques", value: d.hasCas ? "Oui" : "Non" },
    { label: "Questions d association", value: d.hasComb ? "Oui" : "Non" },
    { label: "Questions avec schema", value: d.schemaQuestions.length ? d.schemaQuestions.join(", ") : "Aucune" },
    { label: "Questions manquantes", value: d.missingPositions.length ? d.missingPositions.join(", ") : "Aucune" },
    { label: "Etat workflow", value: d.status },
  ], PDF_COLORS.blue);
}

function drawAdminAccessSection(doc, d, left) {
  let y = 350;

  y = drawSectionTitle(doc, left, y, "Sources et acces");
  return drawLinksBlock(doc, left, y, 470, "Fichiers relies a cet examen", [
    { label: "PDF original", url: d.pdfUrl },
    { label: "CSV verifie", url: d.csvUrl },
    { label: "Quiz MBset", url: d.quizLink },
  ]);
}

function drawAdminFooter(doc, d, left, right) {
  doc.line(left, 36, right, 36, PDF_COLORS.border, 1);
  doc.text(left, 22, `${d.module} - ${d.ref}`, { font: "F1", size: 8.5, color: PDF_COLORS.gray });
  doc.text(right - 150, 22, `Rapport admin - ${d.year}`, { font: "F1", size: 8.5, color: PDF_COLORS.gray });
}

function buildAdminReportBuffer(input) {
  const d = buildReportContext(input);
  const doc = new SimplePdf();
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  const contentWidth = right - left;

  drawAdminHeader(doc, d, left, contentWidth);
  drawAdminIdentitySection(doc, d, left);
  drawAdminQualitySection(doc, d, left);
  drawAdminAccessSection(doc, d, left);
  drawAdminFooter(doc, d, left, right);

  return doc.toBuffer();
}

module.exports = {
  buildAdminReportBuffer,
};
