// Shared PDF primitives used by both admin and public reports.
// Keep this file focused on low-level drawing, encoding, and shared data shaping.

const PDF_PAGE = { width: 595.28, height: 841.89, margin: 42 };

const PDF_COLORS = {
  teal: [0.06, 0.43, 0.34],
  tealDark: [0.04, 0.32, 0.25],
  tealLight: [0.91, 0.96, 0.94],
  blue: [0.12, 0.37, 0.65],
  amber: [0.73, 0.46, 0.09],
  amberLight: [1.0, 0.95, 0.86],
  green: [0.11, 0.42, 0.23],
  greenLight: [0.92, 0.96, 0.93],
  gray: [0.42, 0.45, 0.5],
  grayLight: [0.95, 0.96, 0.97],
  border: [0.83, 0.86, 0.89],
  red: [0.75, 0.22, 0.18],
  redLight: [1.0, 0.95, 0.95],
  black: [0.1, 0.1, 0.1],
  white: [1, 1, 1],
};

function safeString(value, fallback = "-") {
  const str = String(value ?? "").trim();
  return str || fallback;
}

function normalizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

function buildRef(period, rotation) {
  return `${String(period || "").replace(/\s+/g, "")}${String(rotation || "").replace(/\s+/g, "")}`;
}

function buildBaseReportFilename(data) {
  const yearShort = String(data.year || "").slice(-2);
  const ref = buildRef(data.period, data.rotation);
  return [
    normalizeFilePart(data.wilaya),
    normalizeFilePart(data.level),
    normalizeFilePart(data.module),
    normalizeFilePart(`${yearShort}${ref}`),
  ].filter(Boolean).join("_");
}

function statusLabel(ok, naLabel = "Non applicable") {
  if (ok === null) return naLabel;
  return ok ? "Compatible" : "Probleme";
}

// Windows-1252 characters not covered by plain Latin-1.
const WIN_ANSI_MAP = {
  "\u20AC": 0x80,
  "\u201A": 0x82,
  "\u0192": 0x83,
  "\u201E": 0x84,
  "\u2026": 0x85,
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u02C6": 0x88,
  "\u2030": 0x89,
  "\u0160": 0x8a,
  "\u2039": 0x8b,
  "\u0152": 0x8c,
  "\u017D": 0x8e,
  "\u2018": 0x91,
  "\u2019": 0x92,
  "\u201C": 0x93,
  "\u201D": 0x94,
  "\u2022": 0x95,
  "\u2013": 0x96,
  "\u2014": 0x97,
  "\u02DC": 0x98,
  "\u2122": 0x99,
  "\u0161": 0x9a,
  "\u203A": 0x9b,
  "\u0153": 0x9c,
  "\u017E": 0x9e,
  "\u0178": 0x9f,
};

function encodePdfTextHex(str) {
  const text = String(str).replace(/\r?\n/g, " ");
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (WIN_ANSI_MAP[ch] != null) {
      bytes.push(WIN_ANSI_MAP[ch]);
    } else if (code >= 0 && code <= 255) {
      bytes.push(code);
    } else {
      bytes.push(0x3f);
    }
  }
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

// Minimal single-page PDF writer for the two generated reports.
class SimplePdf {
  constructor() {
    this.commands = [];
    this.page = PDF_PAGE;
  }

  add(cmd) {
    this.commands.push(cmd);
  }

  setFill([r, g, b]) {
    this.add(`${r} ${g} ${b} rg`);
  }

  setStroke([r, g, b]) {
    this.add(`${r} ${g} ${b} RG`);
  }

  rect(x, y, w, h, fill = null, stroke = null, lineWidth = 1) {
    if (fill) this.setFill(fill);
    if (stroke) this.setStroke(stroke);
    this.add(`${lineWidth} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  }

  line(x1, y1, x2, y2, color = PDF_COLORS.border, lineWidth = 1) {
    this.setStroke(color);
    this.add(`${lineWidth} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  text(x, y, text, { font = "F1", size = 10, color = PDF_COLORS.black } = {}) {
    const safe = encodePdfTextHex(text);
    this.setFill(color);
    this.add(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${safe}> Tj ET`);
  }

  estimateWidth(text, size) {
    return String(text).length * size * 0.52;
  }

  wrapText(text, maxWidth, size) {
    const rawLines = String(text).split(/\r?\n/);
    const out = [];
    for (const rawLine of rawLines) {
      const words = rawLine.split(/\s+/).filter(Boolean);
      if (!words.length) {
        out.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.estimateWidth(candidate, size) <= maxWidth || !line) {
          line = candidate;
        } else {
          out.push(line);
          line = word;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  paragraph(x, topY, text, opts = {}) {
    const size = opts.size || 10;
    const lineHeight = opts.lineHeight || Math.round(size * 1.45);
    const lines = this.wrapText(text, opts.width || 400, size);
    let y = topY;
    for (const line of lines) {
      this.text(x, y, line, opts);
      y -= lineHeight;
    }
    return y;
  }

  toBuffer() {
    const contentBuffer = Buffer.from(this.commands.join("\n"), "latin1");
    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };

    const font1 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const font2 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const font3 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>");
    const contentId = addObject(`<< /Length ${contentBuffer.length} >>\nstream\n${contentBuffer.toString("latin1")}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent 6 0 R /MediaBox [0 0 ${this.page.width} ${this.page.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R /F3 ${font3} 0 R >> >> >>`);
    const pagesId = addObject(`<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`);
    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.concat(chunks).length);
      chunks.push(Buffer.from(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`, "latin1"));
    }
    const xrefPos = Buffer.concat(chunks).length;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    chunks.push(Buffer.from(xref, "latin1"));
    chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`, "latin1"));
    return Buffer.concat(chunks);
  }
}

// Reusable layout helpers.
function drawBadge(doc, x, y, text, bgColor, textColor = PDF_COLORS.white) {
  const width = Math.max(54, text.length * 6.2 + 18);
  doc.rect(x, y - 12, width, 20, bgColor, null, 0);
  doc.text(x + 9, y - 1, text, { font: "F2", size: 9, color: textColor });
  return x + width + 8;
}

function drawSectionTitle(doc, x, y, title) {
  doc.text(x, y, title, { font: "F2", size: 14, color: PDF_COLORS.black });
  doc.line(x, y - 8, PDF_PAGE.width - PDF_PAGE.margin, y - 8, PDF_COLORS.teal, 1.5);
  return y - 24;
}

function drawInfoCard(doc, x, yTop, width, title, rows, accent = PDF_COLORS.teal) {
  const rowHeight = 18;
  const height = 34 + rows.length * rowHeight;
  const y = yTop - height;
  const maxLabelWidth = rows.reduce((max, row) => Math.max(max, doc.estimateWidth(`${row.label}:`, 9)), 0);
  const valueX = Math.min(x + width - 110, x + 16 + maxLabelWidth + 24);
  doc.rect(x, y, width, height, PDF_COLORS.grayLight, PDF_COLORS.border, 1);
  doc.rect(x, y, 6, height, accent, null, 0);
  doc.text(x + 16, yTop - 20, title, { font: "F2", size: 11, color: PDF_COLORS.black });
  let cursor = yTop - 38;
  for (const row of rows) {
    doc.text(x + 16, cursor, `${row.label}:`, { font: "F2", size: 9, color: PDF_COLORS.gray });
    doc.text(valueX, cursor, row.value, { font: "F1", size: 9.5, color: PDF_COLORS.black });
    cursor -= rowHeight;
  }
  return y - 14;
}

function drawLinksBlock(doc, x, yTop, width, title, links) {
  const available = links.filter((link) => link.url);
  const rows = available.length || 1;
  const height = 34 + rows * 26;
  const y = yTop - height;
  doc.rect(x, y, width, height, PDF_COLORS.tealLight, PDF_COLORS.border, 1);
  doc.text(x + 16, yTop - 20, title, { font: "F2", size: 11, color: PDF_COLORS.black });
  if (!available.length) {
    doc.text(x + 16, yTop - 46, "Aucun lien disponible", { font: "F1", size: 9.5, color: PDF_COLORS.gray });
    return y - 14;
  }
  let cursor = yTop - 44;
  for (const link of available) {
    doc.text(x + 16, cursor, `${link.label}:`, { font: "F2", size: 9, color: PDF_COLORS.gray });
    const short = link.url.length > 62 ? `${link.url.slice(0, 59)}...` : link.url;
    doc.text(x + 90, cursor, short, { font: "F1", size: 8.5, color: PDF_COLORS.blue });
    cursor -= 26;
  }
  return y - 14;
}

function drawStatCard(doc, x, yTop, width, label, value, helper, color = PDF_COLORS.teal) {
  const height = 72;
  const y = yTop - height;
  doc.rect(x, y, width, height, PDF_COLORS.white, PDF_COLORS.border, 1);
  doc.rect(x, y, width, 5, color, null, 0);
  doc.text(x + 14, yTop - 24, label, { font: "F2", size: 10, color: PDF_COLORS.gray });
  doc.text(x + 14, yTop - 48, value, { font: "F2", size: 20, color });
  if (helper) doc.text(x + 14, yTop - 63, helper, { font: "F1", size: 8.5, color: PDF_COLORS.gray });
}

// Shared exam/report data normalization for both report templates.
function buildReportContext(input) {
  const tags = input.tags || {};
  const totalQuestions = Number(tags.nQst || input.totalQuestions || 0) || 0;
  const missingPositions = Array.isArray(tags.missingPos) ? tags.missingPos : [];
  const schemaQuestions = Array.isArray(tags.schemaQsts) ? tags.schemaQsts : [];
  const missingCount = missingPositions.length;
  const availableQuestions = totalQuestions ? totalQuestions - missingCount : 0;
  return {
    module: safeString(input.module),
    wilaya: safeString(input.wilaya),
    year: safeString(input.year),
    level: safeString(input.level),
    rotation: safeString(input.rotation),
    period: safeString(input.period),
    examDate: safeString(input.examDate),
    member: safeString(input.member),
    status: safeString(input.status),
    pdfUrl: input.pdfUrl || "",
    csvUrl: input.csvUrl || "",
    quizLink: input.quizLink || "",
    totalQuestions,
    availableQuestions,
    missingCount,
    missingPositions,
    schemaQuestions,
    hasCT: !!tags.hasCT,
    hasCas: !!tags.hasCas,
    hasComb: !!tags.hasComb,
    ref: buildRef(input.period, input.rotation) || "P?R?",
  };
}

module.exports = {
  PDF_PAGE,
  PDF_COLORS,
  SimplePdf,
  safeString,
  normalizeFilePart,
  buildRef,
  buildBaseReportFilename,
  statusLabel,
  drawBadge,
  drawSectionTitle,
  drawInfoCard,
  drawLinksBlock,
  drawStatCard,
  buildReportContext,
};
