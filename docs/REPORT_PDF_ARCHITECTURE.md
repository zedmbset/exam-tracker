# Report PDF Architecture

This document explains how the direct Admin and Public PDF reports are organized.

## Current Runtime Flow

1. `public/exam.html`
- builds the report payload from the current exam row
- sends it to `POST /api/report-pdf`

2. `server.js`
- receives the request
- chooses the report type
- calls the correct report builder
- uploads the PDF to Drive
- returns the public URL

3. Report builders
- `src/server/reports/adminReportPdf.js`
- `src/server/reports/publicReportPdf.js`

4. Shared PDF layer
- `src/server/reports/reportPdfShared.js`

## File Ownership

### `src/server/reports/adminReportPdf.js`
Edit this file when you want to change:
- internal/admin report layout
- metadata emphasis
- workflow status presentation
- admin-only sections

Main sections:
- `drawAdminHeader(...)`
- `drawAdminIdentitySection(...)`
- `drawAdminQualitySection(...)`
- `drawAdminAccessSection(...)`
- `drawAdminFooter(...)`

### `src/server/reports/publicReportPdf.js`
Edit this file when you want to change:
- student-facing report layout
- public summary presentation
- stats cards
- access links

Main sections:
- `drawPublicHeader(...)`
- `drawPublicOverviewSection(...)`
- `drawPublicStatsSection(...)`
- `drawPublicAccessSection(...)`
- `drawPublicFooter(...)`

### `src/server/reports/reportPdfShared.js`
Edit this file when you want to change:
- shared PDF engine behavior
- text encoding
- page size/margins
- common colors
- shared cards, badges, and section helpers
- shared report data shaping
- shared filename helpers

Main exports:
- `SimplePdf`
- `PDF_PAGE`
- `PDF_COLORS`
- `drawBadge(...)`
- `drawSectionTitle(...)`
- `drawInfoCard(...)`
- `drawLinksBlock(...)`
- `drawStatCard(...)`
- `buildReportContext(...)`
- `buildBaseReportFilename(...)`

## Editing Rules

- If the change is Admin-only, edit only `src/server/reports/adminReportPdf.js`.
- If the change is Public-only, edit only `src/server/reports/publicReportPdf.js`.
- If the change affects both PDFs, edit `src/server/reports/reportPdfShared.js`.
- Do not move report layout logic back into `public/exam.html`.
- Keep these exports stable:
  - `buildAdminReportBuffer`
  - `buildPublicReportBuffer`
  - `buildReportContext`

## Data Contract

Both report builders receive a normalized exam payload containing values like:
- `module`
- `wilaya`
- `year`
- `level`
- `period`
- `rotation`
- `examDate`
- `status`
- `pdfUrl`
- `affichagePdfUrl`
- `csvUrl`
- `quizLink`
- `tags.hasCT`
- `tags.hasCas`
- `tags.hasComb`
- `tags.missingPos`
- `tags.schemaQsts`

The canonical normalization happens in:
- `src/server/reports/reportPdfShared.js`
- `buildReportContext(...)`

If you add a new report field:
1. update `buildReportPayload()` in `public/exam.html`
2. update `buildReportContext()` in `src/server/reports/reportPdfShared.js`
3. update the relevant PDF file

Current Admin-only document links include:
- original PDF
- affichage PDF
- Excel source
- Google Sheets link
- MBset quiz link when available

## Quick Test Checklist

1. Start `server.js`.
2. Open an exam detail page.
3. Generate Admin PDF.
4. Generate Public PDF.
5. Open the returned Drive links.
6. Check layout, encoding, and links.
