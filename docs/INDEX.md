# Documentation Index

This is the main entry point for project documentation.

## Read In This Order

1. `../README.md` - GitHub entry page and quick orientation
2. `../PROJECT_OVERVIEW.md` - quick project overview, architecture, runtime, and key references
3. `AI_CHAT_INSTRUCTIONS.md` - persistent AI workflow preferences for this repository
4. `TECHNICAL_OVERVIEW.md` - practical technical reference for structure, fields, and behavior
5. `PROJECT_DOCUMENTATION.md` - broad generated project documentation and repository-wide analysis
6. `SCHEMA.md` - authoritative sheet/database schema used by the app
7. `EXAM_DATA.md` - exam data structure and expected content rules
8. `PROMPT_EDITING_RULES.md` - safe editing rules for prompts and report-related behavior
9. `REPORT_PDF_ARCHITECTURE.md` - PDF generation structure and backend report flow
10. `SUBCATEGORY_UI_GUIDE.md` - UI-specific guidance for subcategory behavior
11. `EXAM_HTML_PATCH.md` - targeted patch notes for `public/exam.html`

## Document Map

- `../README.md`
  - Use for: first look at the repository from GitHub or local root
  - Priority: high for first-time orientation

- `../PROJECT_OVERVIEW.md`
  - Use for: quick technical overview, runtime notes, and architecture summary
  - Priority: high for fast local understanding

- `AI_CHAT_INSTRUCTIONS.md`
  - Use for: project-specific AI collaboration preferences
  - Priority: high for every new AI chat

- `TECHNICAL_OVERVIEW.md`
  - Use for: deeper technical reference for routes, fields, uploads, and page behavior
  - Priority: high when changing app behavior or onboarding technically

- `PROJECT_DOCUMENTATION.md`
  - Use for: generated repo-wide documentation, structure maps, and wider technical context
  - Priority: medium to high when onboarding or auditing the repository

- `SCHEMA.md`
  - Use for: Google Sheet columns, runtime fields, and JSON shapes
  - Priority: high when changing data handling

- `EXAM_DATA.md`
  - Use for: exam content definitions and data expectations
  - Priority: medium to high when working on prompts or data display

- `PROMPT_EDITING_RULES.md`
  - Use for: prompt/report editing boundaries and output contracts
  - Priority: high when editing prompts or PDF logic

- `REPORT_PDF_ARCHITECTURE.md`
  - Use for: how PDF reports are built and where responsibilities live
  - Priority: medium to high for report changes

- `SUBCATEGORY_UI_GUIDE.md`
  - Use for: subcategory UI behavior and implementation details
  - Priority: medium when touching related UI

- `EXAM_HTML_PATCH.md`
  - Use for: focused notes about `public/exam.html`
  - Priority: medium when patching exam page behavior

- `project_summary.json`
  - Use for: machine-readable summary data
  - Priority: low for manual reading

- `project_doc_generator.js`
  - Use for: regenerating documentation artifacts
  - Priority: low unless maintaining docs tooling

## Root Files

- `../README.md`
  - Purpose: public-facing repository homepage

- `../PROJECT_OVERVIEW.md`
  - Purpose: concise technical summary of the app for fast orientation

## Docs Folder Files

- `AI_CHAT_INSTRUCTIONS.md`
  - Purpose: store persistent AI workflow rules for this repo

- `EXAM_DATA.md`
  - Purpose: explain exam data content and expectations

- `EXAM_HTML_PATCH.md`
  - Purpose: focused notes for patching `public/exam.html`

- `INDEX.md`
  - Purpose: central navigation file for all docs

- `PROJECT_DOCUMENTATION.md`
  - Purpose: large generated repository documentation

- `project_doc_generator.js`
  - Purpose: generate documentation outputs

- `project_summary.json`
  - Purpose: machine-readable documentation summary

- `PROMPT_EDITING_RULES.md`
  - Purpose: guardrails for editing prompts and report-related output behavior

- `REPORT_PDF_ARCHITECTURE.md`
  - Purpose: explain how report PDF generation is organized

- `SCHEMA.md`
  - Purpose: source of truth for Google Sheet schema and stored structures

- `SUBCATEGORY_UI_GUIDE.md`
  - Purpose: explain subcategory UI behavior and related implementation details

- `TECHNICAL_OVERVIEW.md`
  - Purpose: practical app-level technical reference

## Maintenance Rules

- Add new docs here when they become part of the normal reading flow.
- Keep descriptions short and practical.
- Prefer one authoritative file per topic.
- If two docs overlap, note which one is the source of truth.
