# Exam Tracker — Database Schema

This file is the authoritative technical reference for the Google Sheet database used by the Exam Tracker app. Use it when writing code, designing features, or prompting AI models.

Each exam is one row in the `Exams_Tracking` tab. There are 15 columns (A–O), grouped into 5 tagged categories.

---

## Column Groups

| Group | Tag | Purpose |
|-------|-----|---------|
| Exam Identity | `[identity]` | Fixed metadata that identifies the exam — set by admin, never edited by members |
| System / Admin | `[system]` | Operational fields managed by admins or automation |
| Member Task | `[member-task]` | Fields filled in by the assigned member during digitization |
| Files & Links | `[links]` | URLs pointing to files on Google Drive or external tools |
| Import | `[import]` | MBset import tracking |

---

## Full Column Reference

### [identity] — Exam Identity

Fields that uniquely describe which exam this row refers to. Set by admin during row creation. Members should not edit these.

| Col | Index | Tag | Name | Type | Valid values / format | Who fills | Description |
|-----|-------|-----|------|------|-----------------------|-----------|-------------|
| B | 1 | `[identity]` | Wilaya | text | `Const`, `STF`, `Msila` | System / admin | The team (city/wilaya) responsible for digitizing this exam |
| C | 2 | `[identity]` | Year | text | `2024`, `2025` | System / admin | Academic year the exam was administered |
| D | 3 | `[identity]` | Level | text | `1ère année`, `2ème`, `Résidanat` | System / admin | Medical school year or programme level |
| E | 4 | `[identity]` | Rotation | text | `R1`, `R2`, `S2`, `Rtrpg`, `—` | System / admin | Academic rotation or semester within the year |
| F | 5 | `[identity]` | Period | text | free text | System / admin | Academic period within the rotation |
| G | 6 | `[identity]` | Module | text | `Cardio`, `Pneumo`, `Gastro` | System / admin | Medical module / subject name |
| J | 9 | `[identity]` | ExamDate | date | `YYYY-MM-DD` | Member | Date the exam was originally administered to students |

---

### [system] — System / Admin

Operational fields managed by admins, supervisors, or automation. Not expected to be edited by regular members.

| Col | Index | Tag | Name | Type | Valid values / format | Who fills | Description |
|-----|-------|-----|------|------|-----------------------|-----------|-------------|
| A | 0 | `[system]` | ID_Exams | text | Unique ID string | System / admin | Unique row identifier. Used as the `?id=` URL parameter on the exam detail page |
| H | 7 | `[system]` | Start | date | `YYYY-MM-DD` | System / admin | Date the digitization work was assigned or started |
| I | 8 | `[system]` | End | date | `YYYY-MM-DD` | System / admin | Deadline or completion date for this exam |
| K | 10 | `[system]` | Status | select | `✅ Completed`, `In Progress`, `Pending`, `Not Started` | Member | Overall processing status of the exam |

---

### [member-task] — Member Task

Fields the assigned member fills in during the digitization process. These are the primary editable fields on `exam.html`.

| Col | Index | Tag | Name | Type | Valid values / format | Who fills | Description |
|-----|-------|-----|------|------|-----------------------|-----------|-------------|
| N | 13 | `[member-task]` | Membre | email | `name@gmail.com` | Auto (Google sign-in) | Gmail of the member working on this exam. Auto-populated from Google OAuth on sign-in |
| O | 14 | `[member-task]` | Tags | JSON string | See Tags JSON schema below | Member | Structured metadata JSON. Stores nQst, missingQsts, missingPos, schemaQsts, hasCT |

#### Tags JSON Schema (col N)

```json
{
  "nQst": 30,
  "missingQsts": 2,
  "missingPos": [5, 12],
  "schemaQsts": [3, 7, 10],
  "hasCT": true
}
```

| Key | Type | Description |
|-----|------|-------------|
| `nQst` | integer | Total number of questions in the exam. Used in AI prompt and completeness check. |
| `missingQsts` | integer | Count of questions with missing content. |
| `missingPos` | integer[] | Positions of missing questions, e.g. `[5, 12, 23]`. |
| `schemaQsts` | integer[] | Positions of questions that include a schema or table, e.g. `[3, 7, 10, 11, 12]`. |
| `hasCT` | boolean | Whether the original PDF includes a Corrigé Type. Embedded in upload filenames. |

---

### [links] — Files & Links

URL fields pointing to files on Google Drive or external tools. Each link is set by the member after completing the corresponding step.

| Col | Index | Tag | Name | Type | Valid values / format | Who fills | Description |
|-----|-------|-----|------|------|-----------------------|-----------|-------------|
| L | 11 | `[links]` | OrigPDF | url | Google Drive `https://drive.google.com/…` | Auto (upload) or Member | Link to the original exam PDF on Drive. Set automatically by the PDF upload zone, or pasted manually. |
| M | 12 | `[links]` | Quiz_Tbl | url | Google Drive `https://drive.google.com/…` | Auto (upload) or Member | Link to the Excel/CSV QCM table on Drive. Set automatically by the file upload zone, or pasted manually. |

---

## Definition of "Complete"

A row is considered **complete** when all 4 of the following conditions are met:

| Condition | Source | Check |
|-----------|--------|-------|
| Status | col J (Status) | non-empty |
| Drive link | col O (Drive) or col K (OrgnlExam) | non-empty |
| Quiz link | col P (QuizLink) | non-empty |
| N° of questions | Tags JSON `nQst` key (col N) | non-zero |

The dashboard `index.html` counts rows matching this definition for the "Completed" stat card. The `getMissing(row)` function in both `index.html` and `exam.html` implements this check using `parseTags(row)` for the Tags-sourced fields.

---

## Column Relationships

```
OrgnlExam (K) ──→ Original exam PDF on Google Drive
                   └─ Set by: PDF upload zone in exam.html → /api/upload → Drive API

DBTbl (L) ──────→ Member's Excel QCM table on Google Drive
                   └─ Set by: Excel upload zone in exam.html → /api/upload → Drive API

Drive (O) ──────→ Primary digitized content link on Google Drive
                   └─ Set by: Member manually, or via upload

QuizLink (P) ───→ MBset quiz URL
                   └─ Set by: Member after creating the MBset quiz

Mbset (S) ──────→ MBset set ID
                   └─ Relates to: QuizLink (P) and MBsetStatus (R)
```

---

## Referencing Groups in Tasks and Designs

When writing a task or design brief, reference a group by its tag to mean all columns in that group:

| Tag | Columns |
|-----|---------|
| `[identity]` | Wilaya (B), Year (C), Level (D), Rotation (E), Module (F), ExamDate (I) |
| `[system]` | ID_Exams (A), Start (G), End (H), Status (J) |
| `[member-task]` | Membre (M), Tags/JSON (N) |
| `[links]` | OrgnlExam (K), DBTbl (L), Drive (O), QuizLink (P) |

**Example usage in a task description:**
> "Display all `[identity]` fields as read-only badges at the top of the exam page. Only show `[member-task]` fields in the editable form."
