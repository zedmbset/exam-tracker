# Prompt And Report Editing Rules

This guide is for admins and teammates who edit either prompts or the direct report PDF modules.

Active files:
- `public/prompts/digitizePrompt.js`
- `public/prompts/doubleCheckPrompt.js`
- `src/server/reports/adminReportPdf.js`
- `src/server/reports/publicReportPdf.js`

Use this together with `docs/EXAM_DATA.md`.

## Core Rule

- `public/exam.html` should coordinate the workflow.
- Prompt wording belongs in the split prompt files.
- Admin/Public PDF design belongs in the backend report modules.
- Do not reintroduce large prompt or PDF-layout blocks into `public/exam.html`.

## File Responsibilities

- `public/prompts/digitizePrompt.js`: first-model extraction prompt only
- `public/prompts/doubleCheckPrompt.js`: second-model verification prompt only
- `src/server/reports/adminReportPdf.js`: server-side admin/internal PDF layout
- `src/server/reports/publicReportPdf.js`: server-side public/student PDF layout
- `src/server/reports/reportPdfShared.js`: shared PDF helpers and report data shaping

## Output Contracts To Preserve

### Step 1
- one single `tsv` block only
- no prose before the table
- no prose after the table
- no report section
- `[INCERTAIN: ...]` stays inline in TSV only

### Step 2
- if everything is confirmed:
  - one single `text` block
  - starts with `VALIDATION PASSED`
  - contains the validation summary
  - contains `----- FINAL TSV -----`
  - contains the final TSV in the same block
- if any blocking issue remains:
  - one single `text` block
  - starts with `VALIDATION FAILED`
  - no TSV if blocked
- if an `[INCERTAIN]` item is disputed:
  - review table only
  - no TSV

## Dynamic Data Rules

- Prompt files receive data from `getExamContext()` in `public/exam.html`.
- Report PDFs receive data from `buildReportPayload()` and `/api/report-pdf`.
- Do not hardcode one exam unless the file is intentionally example-only.
- If you need a new field, update every caller that depends on it.

## Safe Editing Rules

- Keep these exported function names stable unless callers are updated:
  - `generateDigitizePrompt`
  - `generateDoubleCheckPromptFromContext`
  - `generateDoubleCheckPrompt`
  - `buildAdminReportBuffer`
  - `buildPublicReportBuffer`
- If you change a signature, update `public/exam.html` or `server.js` accordingly.

## Formatting Rules

- Prefer ASCII-safe source text when possible.
- Avoid mojibake or decorative Unicode separators.
- Keep line breaks intentional and readable.

## Browser Test Checklist

1. Open exam detail page.
2. Check Step 1 prompt display and copy button.
3. Check Step 2 prompt display and copy button.
4. Confirm Step 3 still recognizes the expected final format.
5. If you edited `src/server/reports/adminReportPdf.js`, generate the admin PDF and open the Drive link.
6. If you edited `src/server/reports/publicReportPdf.js`, generate the public PDF and open the Drive link.
7. Hard refresh before concluding an edit failed.

## Common Mistakes To Avoid

- putting prompt text back into `exam.html`
- changing Step 2 output without updating Step 3 parsing
- hardcoding one module/year into live files
- editing dead deprecated files instead of the active modules
- duplicating functions with the same name in `exam.html`
