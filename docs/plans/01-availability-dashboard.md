# Plan #01 — Availability Dashboard Page

> Task #1 · Status: MERGED

## What & Why
Add a public-facing "available exams" overview page modeled after the attached mockup (`QCM 2025 - Maintenant Disponibles sur la Plateforme`). It lets anyone see, at a glance, which QCMs are ready on the platform for a given Year + Wilaya, grouped by Level (1ère–6ème Année). It complements the existing operational dashboard (`public/index.html`), which is work-oriented.

## Done looks like
- A new page at `/availability.html` is reachable via a button/link from the top of the main dashboard (`public/index.html`).
- The page has two filter controls at the top: **Year** (from column C) and **Wilaya** (from column B). Both default to the most recent Year and the first Wilaya available, and the page updates instantly when either changes.
- The title reads `QCM <Year> - Maintenant Disponibles sur la Plateforme` and updates with the Year filter.
- Below the title, six cards are laid out in a responsive 3×2 grid (1ère, 2ème, 3ème / 4ème, 5ème, 6ème Année):
  - **1ère / 2ème / 3ème Année cards** show a simple module list with a single green check or empty checkbox next to each module name.
  - **4ème / 5ème / 6ème Année cards** show a matrix: one row per module, seven columns — `R1`, `R2`, `R3`, `ECOS R1`, `ECOS R2`, `ECOS R3`, `Ratrpg` — each cell is a green check or empty checkbox.
- A cell/row is "checked" **only when** at least one exam row exists for that (Year, Wilaya, Level, Module, and the relevant Rotation/Period slot) with `Status = ✅ Completed` (i.e., `Quiz_Tbl` present). All other states (Pending, New, Missing, blank) render as empty.
- Module lists inside each card are built dynamically from the sheet: every module that has any row for that Year+Wilaya+Level appears, checked or not, sorted alphabetically. There is no hardcoded module list.
- Column→cell mapping for years 4–6:
  - `R1` / `R2` / `R3` → `Rotation = R1/R2/R3` AND `Period` is not `ECOS` and not `Ratrpg`
  - `ECOS R1` / `ECOS R2` / `ECOS R3` → `Rotation = R1/R2/R3` AND `Period = ECOS`
  - `Ratrpg` → `Period = Ratrpg` (any rotation)
- Visual style follows the mockup: rounded white cards on a dark blue/purple gradient background, colored header pills on the rotation/period columns, green filled check on match, empty outlined square on no match. Uses the same webfont and overall look-and-feel as the existing app so it feels like part of the product.
- Page is mobile-responsive: cards stack to a single column on narrow screens, matrix becomes horizontally scrollable if needed.
- No authentication required — page is public and shareable (same access level as the existing dashboard).

## Out of scope
- Editing / uploading from this page. It is purely a read-only overview.
- Linking each checkbox to the underlying exam detail page (can be a follow-up).
- Exporting the overview as PDF or image.
- Hardcoding canonical module lists per year — modules are discovered from sheet data only.
- Changing the main dashboard layout beyond adding a single navigation link.

## Tasks
1. **Availability page** — Create `public/availability.html` that fetches existing sheet data, applies Year + Wilaya filters, groups rows by Level, computes the checked/unchecked state per module (and per column for years 4–6) using only the "Completed" status, and renders the six cards with the styling from the mockup.
2. **Navigation link** — Add a visible button/link in the header area of `public/index.html` that opens the new availability page, preserving current filters where sensible (at minimum passing the selected Wilaya via query string if one is active).

## Relevant files
- `public/index.html`
- `public/exam.html`
- `server.js`
- `docs/SCHEMA.md`
