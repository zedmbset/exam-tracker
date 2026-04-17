# AI Chat Instructions

This file stores persistent working preferences for AI assistants working on this project. Update this file whenever new preferences or conventions are established.

## Project Identity

- **App name**: Exam Tracker
- **Repo**: `github.com/zedmbset/exam-tracker`
- **Primary branch**: `main`

## Working Preferences

### Code Changes
- Always read the file before editing it
- Prefer targeted edits over full rewrites
- Keep changes minimal and focused on the task
- Never hardcode secrets or credentials

### Documentation
- Keep `docs/SCHEMA.md` as the authoritative source for column indices
- `docs/TECHNICAL_OVERVIEW.md` should reflect the actual sheet structure (not a planned/future one)
- Update `replit.md` and `PROJECT_OVERVIEW.md` whenever major architectural changes are made

### Column Indices
The correct column indices (0-based) are defined in `docs/SCHEMA.md`. The authoritative mapping is in `public/exam.html` COLS object. Always use that as the source of truth, not older duplicated references.

### Git / GitHub
- Push to GitHub using the `GITHUB_TOKEN` secret with this exact pattern (the only one that works reliably):
  ```bash
  git push https://x-access-token:${GITHUB_TOKEN}@github.com/zedmbset/exam-tracker.git main
  ```
- **When to push**: at the end of each completed task — when all related changes are done and working. Do NOT push after every individual file edit. Pushing too often triggers unnecessary Railway redeploys and clutters the Git history.
- Always do a fetch before pushing to avoid force-push situations
- The remote is: `https://github.com/zedmbset/exam-tracker`

### Testing
- After any backend change, restart the "Start application" workflow
- After any frontend change (HTML/JS/CSS), a browser refresh is sufficient
- Verify status filter and search after changes to `getFiltered()` or `deriveStatusForRow()`

## Known Issues / History
- `docs/TECHNICAL_OVERVIEW.md` replaced the older duplicate technical overview file and should be treated as the active deep-reference document
- The `index.html` COLS was missing `categoryId` (index 6) and `AffichagePDF` (index 13), causing wrong status derivation
