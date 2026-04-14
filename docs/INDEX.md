# Documentation Index

This file describes the purpose of every important documentation file in the project and the recommended reading order.

## Reading Order

| Order | File | Purpose |
|---|---|---|
| 1 | `README.md` | First-time orientation — setup, env vars, quick start |
| 2 | `docs/INDEX.md` | This file — documentation map |
| 3 | `PROJECT_OVERVIEW.md` | High-level technical summary of the app |
| 4 | `docs/TECHNICAL_OVERVIEW.md` | Deep technical reference (structure, columns, logic, upload conventions) |
| 5 | `docs/SCHEMA.md` | Authoritative Google Sheet column schema and JSON shapes |
| 6 | Topic-specific files below | Feature-specific deep dives |

## Topic-Specific Files

| File | Purpose |
|---|---|
| `docs/SCHEMA.md` | Full database schema — column indices, Tags JSON, Membre JSON, status rules |
| `docs/PROJECT_DOCUMENTATION.md` | Auto-generated full project documentation |
| `docs/EXAM_DATA.md` | Exam data structure, question format, TSV/JSON conventions |
| `docs/EXAM_HTML_PATCH.md` | Patch instructions for updating exam.html |
| `docs/PROMPT_EDITING_RULES.md` | Rules for editing the AI digitization prompts |
| `docs/SUBCATEGORY_UI_GUIDE.md` | Guide for the subcategory mapping UI |
| `docs/REPORT_PDF_ARCHITECTURE.md` | PDF report generation architecture |
| `docs/AI_CHAT_INSTRUCTIONS.md` | Persistent AI working preferences for this project |

## Documentation Rules

- `replit.md` is kept as the Replit-facing memory file.
- `docs/TECHNICAL_OVERVIEW.md` is the active deep technical reference.
- Do not reintroduce `docs/replit.md` as a separate technical source.

## Key Design Notes

- The backend is a **secure proxy** — no Google credentials are ever sent to the browser
- Google Sheets is the **only database** — no SQL, no Postgres
- Status (`✅ Completed`, `🕒 Pending`, `🆕 New Exam`, `✖️ Missing`) is **fully derived** from row data, never set manually
- The `Tags` column (Q, index 16) stores a JSON string with all per-exam metadata
