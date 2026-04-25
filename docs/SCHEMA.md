# Exam Tracker - Database Schema

This file is the authoritative technical reference for the Google Sheet database used by the Exam Tracker app.

Each exam is one row in the `Exams_Tracking` tab. `ExamSession` is now the authoritative session field and replaces the old `Rotation` + `Period` pair.

## Main Runtime Columns

| Col | Index | Name | Purpose |
|-----|-------|------|---------|
| A | 0 | ID_Exams | Unique exam row identifier used in `?id=` links |
| B | 1 | Wilaya | Faculty / wilaya |
| C | 2 | Year | Exam year |
| D | 3 | Level | Student level |
| E | 4 | ExamSession | Canonical compact session code |
| F | 5 | categoryId | Module identifier(s); composed exams store multiple IDs separated by commas |
| G | 6 | Module | Module name shown in the app |
| H | 7 | Start | Work start date |
| I | 8 | End | Work end date |
| J | 9 | ExamDate | Real exam date |
| K | 10 | Status | Auto-maintained workflow status derived from `ExamDate`, `OrigPDF`, and `Quiz_Tbl` |
| L | 11 | OrigPDF | Original exam PDF Drive URL |
| M | 12 | AffichagePDF | Affichage PDF Drive URL |
| N | 13 | Quiz_Tbl | Final Excel table Drive URL |
| O | 14 | Membre | JSON history of member participation by Gmail and step activity |
| P | 15 | Tags | JSON metadata |
| Q | 16 | Quiz_Link | MBset quiz URL |
| R | 17 | Admin_Report | Generated Admin PDF URL |
| S | 18 | Public_Report | Generated Public PDF URL |

Deprecated legacy columns:
- `Rotation`
- `Period`

## ExamSession Codes

Stored in column `E` (`ExamSession`) as a plain string.

Canonical values:
- Clinical: `R1-P1`, `R1-P2`, `R1-P3`, `R2-P1`, `R2-P2`, `R2-P3`, `R3-P1`, `R3-P2`, `R3-P3`
- Clinical with missing legacy period: `R1-UNK`, `R2-UNK`, `R3-UNK`
- Preclinical: `S1`, `S2`
- Special: `RTRPG`, `SYNTH`

Rules:
- `SYNTH` is valid only for `Level = 6A`
- legacy typo `Syth` is normalized to `SYNTH`
- legacy `Rtrpg` / `Rattrapage` values are normalized to `RTRPG`
- UI and backend derive display labels and validation from the shared `src/shared/examSession.js` helper, not from legacy columns

## Membre History JSON Shape

Stored in column `P` (`Membre`).

```json
{
  "version": 1,
  "participants": [
    {
      "email": "member1@gmail.com",
      "name": "Member One",
      "steps": {
        "Step 1": {
          "count": 2,
          "firstAt": "2026-04-12T10:00:00.000Z",
          "lastAt": "2026-04-12T10:05:00.000Z"
        },
        "Step 3": {
          "count": 1,
          "firstAt": "2026-04-12T11:30:00.000Z",
          "lastAt": "2026-04-12T11:30:00.000Z"
        }
      },
      "timeline": [
        { "step": "Step 1", "at": "2026-04-12T10:00:00.000Z" },
        { "step": "Step 1", "at": "2026-04-12T10:05:00.000Z" },
        { "step": "Step 3", "at": "2026-04-12T11:30:00.000Z" }
      ]
    }
  ],
  "updatedAt": "2026-04-12T11:30:00.000Z"
}
```

Notes:
- each Gmail appears once in `participants`
- each save increments the related step `count`
- `timeline` keeps every save event for that member
- legacy rows that still contain a plain email are read safely and upgraded on the next save

## Tags JSON Shape

Stored in column `Q` (`Tags`).

```json
{
  "nQst": 30,
  "lang": "Francais",
  "missingPos": [5, 12],
  "schemaQsts": [3, 7, 10],
  "hasCT": true,
  "hasCas": false,
  "hasComb": false,
  "subcategories": [
    {
      "name": "Anatomie",
      "range": "1-20"
    },
    {
      "name": "Biochimie",
      "range": "21-40"
    }
  ],
  "composedSubmodules": [
    {
      "name": "Néphrologie",
      "categoryId": "Cnst_NEPHROLOGIE",
      "range": "1-12"
    },
    {
      "name": "Urologie",
      "categoryId": "Cnst_UROLOGIE",
      "range": "13-20"
    }
  ]
}
```

| Key | Type | Description |
|-----|------|-------------|
| `nQst` | integer | Total number of questions |
| `lang` | string | Exam language |
| `missingPos` | integer[] | Missing or unreadable question numbers |
| `schemaQsts` | integer[] | Questions containing schema/image/table content |
| `hasCT` | boolean | Whether original PDF includes a Corrige Type |
| `hasCas` | boolean | Whether exam contains clinical cases |
| `hasComb` | boolean | Whether exam contains association/combination questions |
| `subcategories` | object[] | Array of subcategory mappings (Unit 1-5 or Résidanat only) |
| `composedSubmodules` | object[] | Array of fixed submodule/categoryId ranges for composed exams |

### Subcategory Mapping

Subcategories are only used for mapped exams:
- Unit 1, Unit 2, Unit 3, Unit 4, Unit 5
- Résidanat

Each subcategory object contains:
- `name`: string - Subcategory name (e.g., "Anatomie", "Biochimie")
- `range`: string - Question range (e.g., "1-20", "21-40")

For normal exams (e.g., Dermatologie), the `subcategories` array is empty or not present.

### Composed Exam Mapping

Composed exams are detected when the row `categoryId` contains multiple IDs separated by commas and the combination matches one of the hardcoded app definitions for that `Wilaya`.

Each `composedSubmodules` object contains:
- `name`: locked submodule name shown in Step 1
- `categoryId`: exact export `categoryId` assigned to that submodule
- `range`: required question range such as `1-12` or `13-20`

Rules:
- ranges are interpreted against real question numbers
- missing questions still belong conceptually to the range that contains them
- missing questions produce no exported row, so later submodule assignment does not shift
- the app rejects overlaps, malformed ranges, and uncovered non-missing questions

## Final TSV Schema

The final TSV is generated by the prompts from the app context and has a dynamic structure.

### Canonical Column Order

The prompts use this canonical order for generating TSV columns:

```
Cas | Num | Text | A | B | C | D | E | F | G | Correct | Exp | Hint | categoryId | tagSuggere | Year | Tag
```

### Column Descriptions

| Column | Source | Description |
|---------|----------|-------------|
| `Cas` | PDF | Clinical case text when applicable |
| `Num` | Derived | Question number (1, 2, 3...) |
| `Text` | PDF | Question stem |
| `A`...`G` | PDF | Propositions (F, G only if used) |
| `Correct` | PDF/CT | Correct answer (from Corrige Type if present) |
| `Exp` | Derived | Explanation template based on Correct |
| `Hint` | PDF | Association/combination helper (only for association questions) |
| `categoryId` | App context / derived mapping | Simple exam: row `categoryId`; composed exam: submodule-specific `categoryId` from saved ranges |
| `tagSuggere` | Derived | Subcategory name for mapped exams only |
| `Year` | App context | Always the exam year from context |
| `Tag` | Derived | 4 derived tags, exported as comma-space text |

### Dynamic Column Pruning

After generating all rows for an exam:
1. Inspect all rows for that exam
2. Remove any column whose cells are empty for ALL rows
3. Preserve canonical order among remaining columns
4. Pruning is per exam, never per row

Examples:
- If no row uses `F`, remove `F`
- If no row uses `Hint`, remove `Hint`
- If no row uses `tagSuggere`, remove `tagSuggere`
- If all `Correct` are empty, `Exp` will also be empty, so both may disappear

### Tag Construction

The `Tag` column is built internally as a JSON array with exactly 4 elements in this order, then exported as comma-space text:

1. Exam type and wilaya: `"Externat <Wilaya>"` or `"Résidanat <Wilaya>"`
2. Period/year or subcategory/year:
   - For Externat: `"<Period> <Year>"` (e.g., "P1 2026")
   - For Résidanat: `"<tagSuggere> <Year>"` (e.g., "Biologie 2023")
3. Question number: `"No. <Num>"` (e.g., "No. 2")
4. Correction type: `"Corrigé type"` (if CT exists) or `"Corrigé proposé"` (if no CT)

Example for Externat:
```json
["Externat Alger", "P1 2026", "No. 2", "Corrigé type"]
```

Example for Résidanat:
```json
["Résidanat Alger", "Biologie 2023", "No. 5", "Corrigé proposé"]
```

| Key | Type | Description |
|-----|------|-------------|
| `nQst` | integer | Total number of questions |
| `lang` | string | Exam language |
| `missingPos` | integer[] | Missing or unreadable question numbers |
| `schemaQsts` | integer[] | Questions containing schema/image/table content |
| `hasCT` | boolean | Whether the original PDF includes a Corrige Type |
| `hasCas` | boolean | Whether the exam contains clinical cases |
| `hasComb` | boolean | Whether the exam contains association/combination questions |

## Completion Rules

A row is treated as complete in the main workflow when these required items exist:
- `OrigPDF`
- `Quiz_Tbl`
- `Tags.nQst`

`AffichagePDF` is optional and does not block completion.

## Status Automation

`Status` is written directly into the sheet and is normally derived by the app. One manual override is supported: a row already marked `Completed` is preserved even when `Quiz_Tbl` is empty.

Automatic rules:
- `Completed`: `Quiz_Tbl` exists
- manual `Completed`: current `Status` is `Completed` and `Quiz_Tbl` is empty; preserved by app sync and batch refresh
- `Pending`: `OrigPDF` exists and `Quiz_Tbl` is still empty
- `New Exam`: exam date is today/past, both `OrigPDF` and `Quiz_Tbl` are empty, and the exam is 0 to 15 days old
- `Missing`: exam date is today/past, both `OrigPDF` and `Quiz_Tbl` are empty, and the exam is more than 15 days old
- empty status: exam date is in the future, blank, or invalid

## Link Ownership

- `OrigPDF`: original exam PDF uploaded in Step 1
- `AffichagePDF`: optional affichage PDF uploaded in Step 1
- `Quiz_Tbl`: final verified Excel file uploaded in Step 3
- `Quiz_Link`: MBset quiz link pasted in Step 4
- `Admin_Report`: generated admin report PDF
- `Public_Report`: generated public report PDF

## Notes For Implementers

- If you add a new file/link field, update both `public/exam.html` and this schema file.
- Report payloads are shaped in `public/exam.html` and normalized in `src/server/reports/reportPdfShared.js`.
- `AffichagePDF` should be treated as an optional document link, not as a required completion field.
