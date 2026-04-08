// Public PDF layout for the student-facing exam handout.
// Keep reportPdfShared.js for common drawing primitives and context shaping.

const {
  PDF_PAGE,
  SimplePdf,
  buildReportContext,
} = require("./reportPdfShared");

// ── Local color palette (public report only) ─────────────────────────────────
const darkGreen   = [0.10, 0.28, 0.20];
const beige       = [0.949, 0.949, 0.925];
const beigeBorder = [0.80, 0.80, 0.76];
const greenBg     = [0.88, 0.96, 0.88];
const greenFg     = [0.10, 0.45, 0.15];
const greenBorder = [0.60, 0.85, 0.60];
const redBg       = [1.0, 0.90, 0.90];
const redFg       = [0.70, 0.15, 0.15];
const redBorder   = [0.90, 0.70, 0.70];
const amberBg     = [1.0, 0.94, 0.80];
const amberBorder = [0.85, 0.65, 0.20];
const amberFg     = [0.60, 0.35, 0.03];
const dimGray     = [0.42, 0.45, 0.50];
const textBlack   = [0.10, 0.10, 0.10];
const bluLink     = [0.12, 0.37, 0.65];
const borderGray  = [0.83, 0.86, 0.89];

function drawPublicHeader(doc, d, left, contentWidth) {
  const hH   = 80;
  const hTop = PDF_PAGE.height - PDF_PAGE.margin - hH;
  doc.rect(left, hTop, contentWidth, hH, darkGreen, null, 0);
  doc.text(left + 22, hTop + hH - 22, d.module,
    { font: "F2", size: 22, color: [1, 1, 1] });
  const sub = [d.wilaya, `Niveau ${d.level}`, d.year, d.examDate]
    .filter(v => v && v !== "-").join("  |  ");
  doc.text(left + 22, hTop + hH - 42, sub,
    { font: "F1", size: 10.5, color: [0.82, 0.93, 0.87] });
  doc.text(left + 22, hTop + hH - 58,
    "Fiche publique de pratique et revision",
    { font: "F3", size: 8.5, color: [0.62, 0.78, 0.70] });
  return hTop;
}

function drawBeigeBlocks(doc, d, left, contentWidth, topY) {
  const blkH   = 78;
  const blkW   = (contentWidth - 16) / 2;
  const blkTop = topY - 14;

  // Block 1 — Questions disponibles
  doc.rect(left, blkTop - blkH, blkW, blkH, beige, beigeBorder, 1);
  doc.text(left + 18, blkTop - 18, "Questions disponibles",
    { font: "F2", size: 9.5, color: [0.38, 0.38, 0.38] });
  doc.text(left + 18, blkTop - 56,
    String(d.availableQuestions || d.totalQuestions || "-"),
    { font: "F2", size: 30, color: darkGreen });

  // Block 2 — Reference
  doc.rect(left + blkW + 16, blkTop - blkH, blkW, blkH, beige, beigeBorder, 1);
  doc.text(left + blkW + 34, blkTop - 18, "Reference",
    { font: "F2", size: 9.5, color: [0.38, 0.38, 0.38] });
  doc.text(left + blkW + 34, blkTop - 56, d.ref,
    { font: "F2", size: 30, color: darkGreen });

  return blkTop - blkH;
}

function drawDetailsSection(doc, d, left, right, contentWidth, topY) {
  let y = topY - 32;

  // Section title + underline
  doc.text(left, y, "Details", { font: "F2", size: 13, color: textBlack });
  doc.line(left, y - 8, right, y - 8, darkGreen, 1.2);
  y -= 28;

  // — Corrige Type block (always shown)
  const ctH      = 58;
  const ctBg     = d.hasCT ? greenBg     : redBg;
  const ctFg     = d.hasCT ? greenFg     : redFg;
  const ctBorder = d.hasCT ? greenBorder : redBorder;
  const ctLabel  = d.hasCT ? "Inclus"    : "Non inclus";
  doc.rect(left, y - ctH, contentWidth, ctH, ctBg, ctBorder, 1);
  doc.rect(left, y - ctH, 5, ctH, ctFg, null, 0);
  doc.text(left + 18, y - 18, "Corrige Type",
    { font: "F2", size: 10, color: dimGray });
  doc.text(left + 18, y - 40, ctLabel,
    { font: "F2", size: 16, color: ctFg });
  y -= ctH + 14;

  // — Questions manquantes block (only if any)
  if (d.missingCount > 0) {
    const mqH   = 58;
    const mqVal = `${d.missingCount} question${d.missingCount > 1 ? "s" : ""}  \u2014  ${d.missingPositions.join(", ")}`;
    doc.rect(left, y - mqH, contentWidth, mqH, amberBg, amberBorder, 1);
    doc.rect(left, y - mqH, 5, mqH, amberFg, null, 0);
    doc.text(left + 18, y - 18, "Questions manquantes",
      { font: "F2", size: 10, color: dimGray });
    doc.text(left + 18, y - 40, mqVal,
      { font: "F2", size: 11, color: amberFg });
    y -= mqH + 14;
  }

  return y;
}

function drawPublicAccessSection(doc, d, left, right, contentWidth, topY) {
  let y = topY - 24;

  // Section title + underline
  doc.text(left, y, "Acc\xe8s", { font: "F2", size: 13, color: textBlack });
  doc.line(left, y - 8, right, y - 8, darkGreen, 1.2);
  y -= 28;

  const linkH = 58;
  doc.rect(left, y - linkH, contentWidth, linkH,
    [0.93, 0.97, 0.95], borderGray, 1);
  doc.rect(left, y - linkH, 5, linkH, darkGreen, null, 0);
  doc.text(left + 18, y - 18, "Quiz MBset",
    { font: "F2", size: 10, color: dimGray });
  if (d.quizLink) {
    const short = d.quizLink.length > 68
      ? d.quizLink.slice(0, 65) + "..."
      : d.quizLink;
    doc.text(left + 18, y - 40, short,
      { font: "F1", size: 9.5, color: bluLink });
  } else {
    doc.text(left + 18, y - 40, "Non disponible",
      { font: "F1", size: 10, color: [0.55, 0.55, 0.55] });
  }

  return y - linkH;
}

function drawPublicFooter(doc, d, left, right) {
  doc.line(left, 36, right, 36, borderGray, 1);
  doc.text(left, 22, `${d.module}  |  ${d.ref}  |  ${d.year}`,
    { font: "F1", size: 8.5, color: [0.50, 0.50, 0.50] });
  doc.text(right - 72, 22, "Fiche publique",
    { font: "F1", size: 8.5, color: [0.50, 0.50, 0.50] });
}

function buildPublicReportBuffer(input) {
  const d = buildReportContext(input);
  const doc = new SimplePdf();
  const left = PDF_PAGE.margin;
  const right = PDF_PAGE.width - PDF_PAGE.margin;
  const contentWidth = right - left;

  const headerTop    = drawPublicHeader(doc, d, left, contentWidth);
  const afterBeige   = drawBeigeBlocks(doc, d, left, contentWidth, headerTop);
  const afterDetails = drawDetailsSection(doc, d, left, right, contentWidth, afterBeige);
  drawPublicAccessSection(doc, d, left, right, contentWidth, afterDetails);
  drawPublicFooter(doc, d, left, right);

  return doc.toBuffer();
}

module.exports = {
  buildPublicReportBuffer,
};
