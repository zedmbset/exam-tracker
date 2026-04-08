# Prompt And Report Editing Rules

 This guide is for admins and teammates who edit either prompts or direct report PDF modules.

 Active files:
 - `public/prompts/digitizePrompt.js`
 - `public/prompts/doubleCheckPrompt.js`
 - `reports/adminReportPdf.js`
 - `reports/publicReportPdf.js`

 Use this together with `docs/EXAM_DATA.md`.

 ## Core Rule

 - `public/exam.html` should coordinate workflow.
 - Prompt wording belongs in split prompt files.
 - Admin/Public PDF design belongs in backend report modules.
 - Do not reintroduce large prompt or PDF-layout blocks into `public/exam.html`.

 ## File Responsibilities

 - `public/prompts/digitizePrompt.js`: first-model extraction prompt only.

 Use this file when you want to improve:
 - extraction instructions
 - TSV formatting rules
 - `[INCERTAIN: ...]` behavior
 - association-question instructions
 - Step 1 output quality

 - `public/prompts/doubleCheckPrompt.js`: second-model verification prompt only.

 Use this file when you want to improve:
 - validation wording
 - `[INCERTAIN]` audit logic
 - final `VALIDATION PASSED` block format
 - dispute review table
 - Step 2 output contract

 - `reports/adminReportPdf.js`: server-side admin/internal PDF layout.

 Use this file when you want to improve:
 - admin report header
 - workflow/status display
 - internal metadata section
 - digitization quality section
 - admin-only links and presentation

 Main sections inside file:
 - `drawAdminHeader(...)`
 - `drawAdminIdentitySection(...)`
 - `drawAdminQualitySection(...)`
 - `drawAdminAccessSection(...)`
 - `drawAdminFooter(...)`

 - `reports/publicReportPdf.js`: server-side public/student PDF layout.

 Use this file when you want to improve:
 - public report header
 - student summary card
 - public statistics cards
 - public access links
 - overall visual style for student use

 Main sections inside file:
 - `drawPublicHeader(...)`
 - `drawPublicOverviewSection(...)`
 - `drawPublicStatsSection(...)`
 - `drawPublicAccessSection(...)`
 - `drawPublicFooter(...)`

 - `reports/reportPdfShared.js`: shared PDF mechanics used by both PDFs.

 Use this file when you want to improve:
 - shared PDF engine behavior
 - text encoding
 - common color palette
 - page size and margins
 - common cards/sections/badges
 - shared report context shaping
 - shared file naming helpers

 Main shared exports:
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

 Rule:
 - if change affects only Admin design, edit `reports/adminReportPdf.js`
 - if change affects only Public design, edit `reports/publicReportPdf.js`
 - if change affects both, edit `reports/reportPdfShared.js`

 ## Output Contracts To Preserve

 ### Step 1
 - one single `tsv` block only
 - no prose before table
 - no prose after table
 - no report section
 - `[INCERTAIN: ...]` stays inline in TSV only

 ### Step 2
 - if everything is confirmed:
   - one single `text` block
   - starts with `VALIDATION PASSED`
   - contains validation summary
   - contains `----- FINAL TSV -----`
   - contains final TSV in same block
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
 - Do not hardcode one exam unless file is intentionally example-only.
 - If you need a new field, update every caller that depends on it.

 ## Canonical TSV Column Order

 The prompts must use this exact canonical order for TSV columns:

 ```
 Cas | Num | Text | A | B | C | D | E | F | G | Correct | Exp | Hint | categoryName | tagSuggere | subcategoryName | Year | Tag
 ```

 Rules:
 - One exam = one single TSV header
 - Keep this order exactly as specified
 - After generating all rows, remove any column that is empty for all rows of that exam
 - `tagSuggere` stays empty for now and therefore will usually disappear
 - Preserve canonical order among remaining columns after pruning
 - Pruning is per exam, never per row

 ### Column Dependencies

 Some columns have dependencies that must be maintained:

 - **Exp** must always track **Correct**:
   - If `Correct` changes, `Exp` must change
   - If `Correct` is empty, `Exp` must be empty
   - If all `Correct` values are empty, both columns may be pruned

 - **Tag** must always track final corrected values:
   - If `Num` changes, `Tag[2]` must change (the "No. X" element)
   - If `subcategoryName` changes in Residanat, `Tag[1]` must change
   - If `hasCT` interpretation changes, `Tag[3]` must still reflect the correct CT mode
   - All four elements must be present in the correct order

 - **subcategoryName** validation:
   - For normal exams (e.g., Dermatologie): must be empty
   - For mapped exams (Unit 1-5 or Residanat): must match the subcategory range
   - Determined from the question number and the `subcategories` mapping in context

 ### Conditional Columns

 These columns may be pruned if not used:

 - **F, G**: Only present if association questions use them
 - **Hint**: Only present if association questions exist
 - **subcategoryName**: Only present for mapped exams
 - **tagSuggere**: Always empty, always pruned
 - **Exp**: Pruned if all `Correct` values are empty

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
 4. Confirm Step 3 still recognizes expected final format.
 5. If you edited `reports/adminReportPdf.js`, generate admin PDF and open Drive link.
 6. If you edited `reports/publicReportPdf.js`, generate public PDF and open Drive link.
 7. Hard refresh before concluding an edit failed.

 ## Common Mistakes To Avoid

 - putting prompt text back into `exam.html`
 - changing Step 2 output without updating Step 3 parsing
 - hardcoding one module/year into live files
 - editing dead deprecated files instead of active modules
 - duplicating functions with same name in `exam.html`
