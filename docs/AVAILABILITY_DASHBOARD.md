# Availability Dashboard (`/availability.html`)

Public-facing read-only overview showing which QCMs are **available on the platform** (i.e. fully digitized and ready for students) for a given **Year + Wilaya**, grouped by student level. Inspired by the "QCM 2025 - Maintenant Disponibles sur la Plateforme" infographic the product team already uses.

This file is the long-lived reference for the page. Update it whenever the page's layout, filter logic, or column mapping changes.

---

## Purpose

- Main dashboard (`/`) is **work-oriented** (tracks what needs to be done).
- Availability dashboard (`/availability.html`) is **outcome-oriented** (shows what is already usable).
- Shareable and public — anyone with the URL can open it.

## Navigation

- A "Disponibilité" button is injected into the top-right of `public/index.html`. It simply links to `/availability.html`.
- The availability page has a "Tableau de bord" back link in its top-left corner.

## Data source

- Single read from `GET /api/sheet` (same endpoint the main dashboard uses).
- Response shape is Google Sheets' native `{ range, majorDimension, values }`. Row 0 is the header, all subsequent rows are data.
- No writes, no auth, no identity handling.

## Column indices — IMPORTANT

The live sheet's header row is resolved dynamically at runtime — **do not hardcode indices** in the availability page. See `resolveCols()` and the `HEADER_ALIASES` map in `public/availability.html`.

Reason: `docs/SCHEMA.md` still lists the "canonical" 20-column layout (with `Start` at H and `End` at I), but the live production sheet does not contain those two columns. As a result:

- Live sheet header: `ID_Exams, Wilaya, Year, Level, Rotation, Period, categoryId, Module, Exam Date, Status, OrigPDF, AffichagePDF, Quiz_Tbl, Membre, Tags, Quiz_Link, Admin_Report, Public_Report, …`
- `public/index.html`'s `COLS` constant still uses the canonical (Start/End-based) indices. It works mostly by coincidence — for the availability page we intentionally avoided the same trap by resolving column indices from the header.

If a future schema change renames `Exam Date` back to `ExamDate`, or adds/removes columns, the dynamic resolver handles it as long as the header labels (or their aliases) stay stable. Aliases live in `HEADER_ALIASES` at the top of the page.

## Completion rule

A module/cell is **checked** when at least one matching row has an effective `Completed` status. This includes normal completion via `Quiz_Tbl` and the supported manual override where the sheet `Status` is already `Completed`.

```js
function isCompleted(row) { return getRowStatus(row) === STATUS_COMPLETED; }
```

- The stored Status column is consulted only for the manual `Completed` override. Otherwise, status is derived from `Quiz_Tbl`, `OrigPDF`, and `ExamDate`.
- All other states (Pending, New Exam, Missing, blank, future-dated) render as an empty checkbox.

For session button colors and the preview modal badge, the page also derives the workflow state from row data at runtime instead of trusting the stored `Status` cell. This avoids stale badges when a row has not been reopened and resaved yet in `public/exam.html`.

## Normalization rules (matrix matching)

Before `MATRIX_COLS[*].matches(rot, per)` is evaluated, `Rotation` and `Period` values are normalized so matching is resilient to typos and casing differences:

- `normRotation(v)` → trimmed + uppercased. `"r1"`, `" R1 "`, and `"R1"` all match `R1`.
- `normPeriod(v)` → trimmed. `ECOS` (any case) maps to `"ECOS"`, `Ratrpg`/`RATRPG`/`Rattrapage` map to `"Ratrpg"`. Any other value passes through unchanged (so unusual `Period` values remain visible in R1/R2/R3 columns).

If you need to add a new Period synonym (e.g. a faculty-specific label for rattrapage), extend `normPeriod` rather than the column matchers.

## Filters

Two dropdowns at the top right of the page:

| Filter | Sheet column | Default | URL param |
|---|---|---|---|
| Année | `Year` (C) | Most recent year, sorted desc | `?year=2025` |
| Wilaya | `Wilaya` (B) | First alphabetically | `?wilaya=Constantine` |

Changing a filter updates the URL via `history.replaceState` so the view is shareable.

The title banner reads `QCM <Year> — Maintenant Disponibles sur la Plateforme`. It updates live with the Year filter.

## Layout

Six cards in a 3×2 responsive grid (3 columns ≥1000px, 2 columns ≥640px, 1 column below).

| Card | Level value | Display mode |
|---|---|---|
| 1ère Année | `1A` | Simple list |
| 2ème Année | `2A` | Simple list |
| 3ème Année | `3A` | Simple list |
| 4ème Année | `4A` | Matrix |
| 5ème Année | `5A` | Matrix |
| 6ème Année | `6A` | Matrix |

### Simple list (years 1–3)

- One row per distinct `Module` found for that Year + Wilaya + Level.
- Each row: checkbox + module name.
- Two columns by default; collapses to one column on narrow viewports or when ≤3 modules exist.

### Matrix (years 4–6)

Seven columns per module row:

| Column | Match condition on a row |
|---|---|
| R1 | `Rotation = R1` AND `Period ≠ ECOS` AND `Period ≠ Ratrpg` |
| R2 | `Rotation = R2` AND `Period ≠ ECOS` AND `Period ≠ Ratrpg` |
| R3 | `Rotation = R3` AND `Period ≠ ECOS` AND `Period ≠ Ratrpg` |
| ECOS R1 | `Rotation = R1` AND `Period = ECOS` |
| ECOS R2 | `Rotation = R2` AND `Period = ECOS` |
| ECOS R3 | `Rotation = R3` AND `Period = ECOS` |
| Ratrpg | `Period = Ratrpg` (any rotation) |

A cell is checked only if at least one row matches **both** the column condition above **and** `isCompleted(row) === true`.

Column definitions live in the `MATRIX_COLS` constant at the top of the page's `<script>` block. Adding or renaming a column means editing that single array.

## Module discovery

Modules are **never hardcoded**. For each card, the page runs:

```js
const modules = [...new Set(rows.map(r => cell(r, 'Module')))].filter(Boolean).sort();
```

Rows with any status count — so a module with no `Quiz_Tbl` yet still appears, just fully unchecked. This means the page naturally reflects whatever modules the sheet currently contains for that (Year, Wilaya, Level) tuple, sorted alphabetically (French locale).

## Visual style

- Dark blue → purple gradient background (`linear-gradient(135deg, #1e3a8a, #4c1d95)`).
- White rounded title banner, oversized.
- Light grey cards (`#f5f5f7`), italic blue title per card.
- Green check (`#22c55e`), outlined empty box for unchecked.
- Rotation header pills: purple (`#7c3aed`) for R1/R2/R3, orange (`#f97316`) for ECOS variants, pill shape (`#ea580c`) for Ratrpg.

Everything is in a single `<style>` block inside `public/availability.html`. No shared stylesheet is pulled in, by design — the page is intentionally self-contained so the operational dashboard's CSS (dark/light theme etc.) does not leak into it.

## Out of scope (intentionally not implemented)

- Clicking a checkbox does **not** navigate to the exam page (potential follow-up).
- No PDF/image export of the overview (potential follow-up).
- No hardcoded per-year module catalog — the sheet is the source of truth.
- No editing from this page.

## Files

| File | Role |
|---|---|
| `public/availability.html` | The entire page — HTML, CSS, client-side JS |
| `public/index.html` | Contains the "Disponibilité" navigation button in the topbar |
| `server.js` | Only relevant line: `express.static('public')` serves `/availability.html` automatically; no dedicated route is needed |

## Security & accessibility

- All sheet-sourced values (module names, wilaya names, year values) are injected with `textContent` (for `<option>` elements via `fillOptions()`) or `escapeHtml()` (for innerHTML-rendered card content). **Never** switch to `innerHTML` with unescaped sheet data — the page is public and the sheet is multi-writer.
- Checkboxes are `<span role="img" aria-checked="…" aria-label="…">` so screen readers announce state + the module/column they belong to.
- The matrix uses a proper `<caption class="sr-only">`, `<th scope="col">` for column headers, and `<th scope="row">` for the module name of each row.

## Changelog

- **2026-04-16** — Initial implementation. Six cards, Year + Wilaya filters, dynamic header-based column resolution, completion based on `Quiz_Tbl` presence.
- **2026-04-16** — Hardened after review: XSS-safe option rendering, `normRotation`/`normPeriod` normalization, fail-loud column resolution with `REQUIRED_HEADERS`, a11y labels on checkboxes and matrix table.
