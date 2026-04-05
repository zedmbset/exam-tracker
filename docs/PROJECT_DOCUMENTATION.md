# 📚 exam-tracker-backend — PROJECT DOCUMENTATION

**Generated:** 2026-04-04 at 13:55:51

**Version:** 1.0.0

**Project Root:** `C:\Younes Hadjidj\2- ZED Python scripts\11- Telegram scripts\exam-tracker`

---

## 📑 TABLE OF CONTENTS

1. [Project Overview](#-project-overview)
2. [Quick Start Guide](#-quick-start-guide)
3. [🚨 CRITICAL: AI File Modification Rules](#-critical-ai-file-modification-rules)
4. [Project Statistics](#-project-statistics)
5. [Project Structure](#-project-structure)
6. [External Dependencies](#-external-dependencies)
7. [Module Documentation](#-module-documentation)
8. [API Endpoints](#-api-endpoints)
9. [Dependency Graph](#-dependency-graph)
10. [Configuration & Environment](#-configuration--environment)
11. [File Naming Conventions](#-file-naming-conventions)
12. [Safety Features](#️-safety-features)
13. [Troubleshooting](#-troubleshooting)
14. [Development Guidelines](#-development-guidelines)
15. [Version History](#-version-history)
16. [Additional Resources](#-additional-resources)

---

## 🎯 PROJECT OVERVIEW

### What is exam-tracker-backend?

Backend server for Exam Tracker app

This project provides:

- Web dashboard for managing and tracking exam digitization progress
- Google Sheets as the database backend (no SQL server required)
- Google Drive for PDF and CSV file storage
- AI-assisted prompt generation for QCM digitization workflows
- Auto-generated Admin and Public PDF reports

**Project Location:**

```
C:\Younes Hadjidj\2- ZED Python scripts\11- Telegram scripts\exam-tracker
```

---

## 🚀 QUICK START GUIDE

### Prerequisites

- Node.js 18 or higher
- npm package manager
- Google service account with Sheets + Drive access

### First Time Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Create a `.env` file at the project root (see Configuration section)

3. **Run the application**
   ```bash
   node server.js
   # or
   npm start
   ```

### Quick Commands

```bash
# Install dependencies
npm install

# Start the server
npm start

# Regenerate documentation
node project_doc_generator.js

# Regenerate with JSON export
node project_doc_generator.js --json
```

---

## 🚨 CRITICAL: AI FILE MODIFICATION RULES

> **🔴 SEVERITY LEVEL: CRITICAL**
> **⚠️ NON-COMPLIANCE WILL RESULT IN DATA LOSS**
> **📖 READ COMPLETELY BEFORE ANY MODIFICATIONS**

### ⚠️ MANDATORY REQUIREMENTS FOR ALL FILE MODIFICATIONS

#### 1️⃣ Auto-Fix Script Requirement

**When ANY file modification is requested, you MUST:**

- Create a standalone Node.js script for the modification
- Script must be placed in the main directory (next to `server.js`)
- Script name format: `autofix_<description>_<timestamp>.js`
  - Example: `autofix_update_prompt_20260404_143022.js`

**Script Requirements:**
```javascript
/**
 * Auto-fix script template
 * Purpose: [Brief description]
 * Created: [Date and time]
 */
const fs   = require('fs');
const path = require('path');

const BACKUP_BASE = path.join(__dirname, '0-Archive', 'backups');
const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const BACKUP_DIR  = path.join(BACKUP_BASE, 'backup_' + ts);

const FILES_TO_MODIFY = ['server.js', 'public/exam.html'];

function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const f of FILES_TO_MODIFY) {
    if (fs.existsSync(f)) {
      fs.copyFileSync(f, path.join(BACKUP_DIR, path.basename(f)));
      console.log('  ✓ Backed up:', f);
    }
  }
}

function applyModifications() {
  // YOUR MODIFICATION CODE HERE
}

createBackup();
applyModifications();
console.log('✅ Auto-fix completed!');
```

#### 2️⃣ Backup Directory Structure (MANDATORY)

```
C:\Younes Hadjidj\2- ZED Python scripts\11- Telegram scripts\exam-tracker/0-Archive/backups/
├── backup_2026-04-04T14-30-22/
│   ├── server.js
│   └── exam.html
└── backup_2026-04-05T09-12-00/
    └── digitizePrompt.js
```

**⚠️ CRITICAL RULES:**
- ✅ **DO:** Create timestamped subfolder (format: `backup_YYYY-MM-DDTHH-MM-SS`)
- ✅ **DO:** Place ALL modified files inside the timestamped subfolder
- ❌ **DON'T:** Put files directly in the backups folder
- ❌ **DON'T:** Create backups anywhere else

#### 3️⃣ Response Format (REQUIRED)

- Provide ONLY the auto-fix script — no long explanations
- One line of instruction: `Place next to server.js and run: node autofix_xxx.js`
- Detailed docs only if the user explicitly asks for them

#### 4️⃣ Prompt and Report File Rules

When editing prompts or report PDFs, follow `PROMPT_EDITING_RULES.md` and `EXAM_DATA.md`.
Stable exported function names — **never rename without updating all callers:**
- `generateDigitizePrompt`
- `generateDoubleCheckPromptFromContext`
- `generateDoubleCheckPrompt`
- `buildAdminReportBuffer`
- `buildPublicReportBuffer`
- `buildReportContext`

### 📋 QUICK REFERENCE CHECKLIST

```
✓ [ ] Created Node.js auto-fix script
✓ [ ] Script includes backup creation code
✓ [ ] Backup uses timestamped subfolder
✓ [ ] Script name includes timestamp
✓ [ ] Response is concise (no unnecessary detail)
✓ [ ] Stable function names preserved
```

---

## 📊 PROJECT STATISTICS

- **Total Files Scanned:** 29
- **Total Classes:** 1
- **Total Functions:** 135
- **Total Lines of Code:** 11 655
- **Comment Lines:** 401
- **API Routes:** 18
- **External Dependencies:** 8

---

## 📁 PROJECT STRUCTURE

```
exam-tracker/
├── 📁 00- Archive
│   ├── 📄 DEPLOYMENT_GUIDE.md
│   ├── 📁 Exam-Tracker-VF- Replit 50 dollars
│   │   └── 📁 Exam-Tracker-VF
│   │       ├── 📄 DEPLOYMENT_GUIDE.md
│   │       ├── 📄 SCHEMA.md
│   │       ├── 📄 package.json
│   │       ├── 📁 public
│   │       │   ├── 📄 exam.html
│   │       │   └── 📄 index.html
│   │       ├── 📄 railway.toml
│   │       ├── 📄 replit.md
│   │       └── 📄 server.js
│   └── 📁 codex-backup-2026-04-01-update-from-Exam-Tracker-VF
│       ├── 📁 public
│       │   ├── 📄 exam.html
│       │   └── 📄 index.html
│       ├── 📄 replit.md
│       └── 📄 server.js
├── 📄 SCHEMA.md
├── 📄 adminReportPdf.js
├── 📄 package.json
├── 📄 project_doc_generator.js
├── 📁 public
│   ├── 📄 EXAM_DATA.md
│   ├── 📄 PROMPT_EDITING_RULES.md
│   ├── 📄 _tmp_exam_inline_check.js
│   ├── 📄 digitizePrompt.js
│   ├── 📄 doubleCheckPrompt.js
│   ├── 📄 exam.html
│   └── 📄 index.html
├── 📄 publicReportPdf.js
├── 📄 railway.toml
├── 📄 replit.md
├── 📄 reportPdfShared.js
└── 📄 server.js
```

---

## 📦 EXTERNAL DEPENDENCIES

### Runtime Dependencies (package.json)

| Package | Version |
|---------|---------|
| `0` | cors |
| `1` | dotenv |
| `2` | express |
| `3` | form-data |
| `4` | multer |
| `5` | node-fetch |

### All Detected External Imports

`cors`  ·  `crypto`  ·  `dotenv`  ·  `express`  ·  `form-data`  ·  `fs`  ·  `multer`  ·  `path`

---

## 🗂️ MODULE DOCUMENTATION

### 📁 `/ (root)/`

#### 📄 `adminReportPdf.js`

| Property | Value |
|----------|-------|
| **Path** | `adminReportPdf.js` |
| **Type** | JS |
| **Lines** | 101 total · 81 code · 2 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `drawAdminHeader(doc, d, left, contentWidth)` | — |
| `drawAdminIdentitySection(doc, d, left)` | — |
| `drawAdminQualitySection(doc, d, left)` | — |
| `drawAdminAccessSection(doc, d, left)` | — |
| `drawAdminFooter(doc, d, left, right)` | — |
| `buildAdminReportBuffer(input)` | — |

**Exports:** `buildAdminReportBuffer`

**Local imports:** `./reportPdfShared`

#### 📄 `package.json`

| Property | Value |
|----------|-------|
| **Path** | `package.json` |
| **Type** | JSON |
| **Lines** | 18 total · 17 code · 0 comments |

**Scripts:** `start`

#### 📄 `project_doc_generator.js`

| Property | Value |
|----------|-------|
| **Path** | `project_doc_generator.js` |
| **Type** | JS |
| **Lines** | 824 total · 668 code · 82 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `now()` | — |
| `relPath(absPath)` | — |
| `walkProject(dir, collected = [])` | — |
| `readFile(filePath)` | — |
| `extractJsFunctions(source)` | — |
| `extractJsClasses(source)` | — |
| `extractJsDependencies(source)` | — |
| `extractExports(source)` | — |
| `extractRoutes(source)` | — |
| `countLines(source)` | — |
| `extractFileDocstring(source)` | — |
| `analyzeHtml(source)` | — |
| `analyzePackageJson(source)` | — |
| `scanProject()` | — |
| `buildDepGraph(modules)` | — |
| `buildTree(modules)` | — |
| `generateMarkdown(data)` | — |
| `exportJson(data, outputPath)` | — |
| `run()` | — |
| `getArg(...)` | — |
| `hasFlag(...)` | — |

**Exports:** `foo`

#### 📄 `publicReportPdf.js`

| Property | Value |
|----------|-------|
| **Path** | `publicReportPdf.js` |
| **Type** | JS |
| **Lines** | 81 total · 65 code · 2 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `drawPublicHeader(doc, d, left, contentWidth)` | — |
| `drawPublicOverviewSection(doc, d, left)` | — |
| `drawPublicStatsSection(doc, d, left)` | — |
| `drawPublicAccessSection(doc, d, left)` | — |
| `drawPublicFooter(doc, d, left, right)` | — |
| `buildPublicReportBuffer(input)` | — |

**Exports:** `buildPublicReportBuffer`

**Local imports:** `./reportPdfShared`

#### 📄 `railway.toml`

| Property | Value |
|----------|-------|
| **Path** | `railway.toml` |
| **Type** | TOML |
| **Lines** | 8 total · 6 code · 0 comments |

#### 📄 `replit.md`

| Property | Value |
|----------|-------|
| **Path** | `replit.md` |
| **Type** | MD |
| **Lines** | 164 total · 123 code · 0 comments |

#### 📄 `reportPdfShared.js`

| Property | Value |
|----------|-------|
| **Path** | `reportPdfShared.js` |
| **Type** | JS |
| **Lines** | 324 total · 288 code · 6 comments |

**Classes:**

| Class | Extends |
|-------|---------|
| `SimplePdf` | — |

**Functions:**

| Function | Async |
|----------|-------|
| `safeString(value, fallback = "-")` | — |
| `normalizeFilePart(value)` | — |
| `buildRef(period, rotation)` | — |
| `buildBaseReportFilename(data)` | — |
| `statusLabel(ok, naLabel = "Non applicable")` | — |
| `encodePdfTextHex(str)` | — |
| `drawBadge(doc, x, y, text, bgColor, textColor = PDF_COLORS.white)` | — |
| `drawSectionTitle(doc, x, y, title)` | — |
| `drawInfoCard(doc, x, yTop, width, title, rows, accent = PDF_COLORS.teal)` | — |
| `drawLinksBlock(doc, x, yTop, width, title, links)` | — |
| `drawStatCard(doc, x, yTop, width, label, value, helper, color = PDF_COLORS.teal)` | — |
| `buildReportContext(input)` | — |

**Exports:** `PDF_PAGE`  ·  `PDF_COLORS`  ·  `SimplePdf`  ·  `safeString`  ·  `normalizeFilePart`  ·  `buildRef`  ·  `buildBaseReportFilename`  ·  `statusLabel`  ·  `drawBadge`  ·  `drawSectionTitle`  ·  `drawInfoCard`  ·  `drawLinksBlock`  ·  `drawStatCard`  ·  `buildReportContext`

#### 📄 `SCHEMA.md`

| Property | Value |
|----------|-------|
| **Path** | `SCHEMA.md` |
| **Type** | MD |
| **Lines** | 143 total · 99 code · 1 comments |

#### 📄 `server.js`

| Property | Value |
|----------|-------|
| **Path** | `server.js` |
| **Type** | JS |
| **Lines** | 238 total · 193 code · 8 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `uploadBufferToDrive(fileBuffer, name)` | ✅ |
| `base64url(buf)` | — |
| `getAccessToken()` | ✅ |
| `fetch(...)` | — |

**Express Routes:**

| Method | Path |
|--------|------|
| `GET` | `/exam` |
| `GET` | `/api/sheet` |
| `PUT` | `/api/sheet/:rowIndex` |
| `POST` | `/api/upload` |
| `POST` | `/api/report-pdf` |
| `GET` | `/api/drive-download` |
| `GET` | `/api/config` |

**Local imports:** `./reportPdfShared`  ·  `./adminReportPdf`  ·  `./publicReportPdf`

### 📁 `00- Archive/`

#### 📄 `DEPLOYMENT_GUIDE.md`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/DEPLOYMENT_GUIDE.md` |
| **Type** | MD |
| **Lines** | 90 total · 65 code · 0 comments |

### 📁 `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/`

#### 📄 `DEPLOYMENT_GUIDE.md`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/DEPLOYMENT_GUIDE.md` |
| **Type** | MD |
| **Lines** | 90 total · 65 code · 0 comments |

#### 📄 `package.json`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/package.json` |
| **Type** | JSON |
| **Lines** | 18 total · 17 code · 0 comments |

#### 📄 `railway.toml`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/railway.toml` |
| **Type** | TOML |
| **Lines** | 8 total · 6 code · 0 comments |

#### 📄 `replit.md`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/replit.md` |
| **Type** | MD |
| **Lines** | 164 total · 123 code · 0 comments |

#### 📄 `SCHEMA.md`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/SCHEMA.md` |
| **Type** | MD |
| **Lines** | 143 total · 99 code · 1 comments |

#### 📄 `server.js`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| **Type** | JS |
| **Lines** | 208 total · 166 code · 10 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `base64url(buf)` | — |
| `getAccessToken()` | ✅ |
| `fetch(...)` | — |

**Express Routes:**

| Method | Path |
|--------|------|
| `GET` | `/exam` |
| `GET` | `/api/sheet` |
| `PUT` | `/api/sheet/:rowIndex` |
| `POST` | `/api/upload` |
| `GET` | `/api/drive-download` |
| `GET` | `/api/config` |

### 📁 `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/public/`

#### 📄 `exam.html`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/public/exam.html` |
| **Type** | HTML |
| **Lines** | 1956 total · 1701 code · 51 comments |

**Page title:** Exam Details
**Inline `<script>` blocks:** 2  ·  **`<style>` blocks:** 1

#### 📄 `index.html`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/public/index.html` |
| **Type** | HTML |
| **Lines** | 827 total · 711 code · 40 comments |

**Page title:** Exam Tracker
**Inline `<script>` blocks:** 1  ·  **`<style>` blocks:** 1

**JavaScript functions defined inside this page:**

| Function | Async |
|----------|-------|
| `toDateInputValue(str)` | — |
| `parseAnnotations(str)` | — |
| `annotationsToString(tags)` | — |
| `tsvToCsv(tsv)` | — |
| `parseRangeInput(str)` | — |
| `boot()` | ✅ |
| `loadSheet()` | ✅ |
| `showDashboard()` | — |
| `colIdx(name)` | — |
| `cell(row, n)` | — |
| `setCell(row, n, v)` | — |
| `parseTags(row)` | — |
| `getMissing(row)` | — |
| `isComplete(row)` | — |
| `renderStats()` | — |
| `populateFilters()` | — |
| `getFiltered()` | — |
| `wilayaBadge(w)` | — |
| `renderTable()` | — |
| `shareExam(id, e)` | — |
| `openFill(idx)` | — |
| `handleFileSelect(input)` | — |
| `handleDrop(e)` | — |
| `setFile(f)` | — |
| `saveRow()` | ✅ |
| `closeModal()` | — |
| `setSyncStatus(state,label)` | — |
| `notify(msg,type)` | — |

### 📁 `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/`

#### 📄 `replit.md`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/replit.md` |
| **Type** | MD |
| **Lines** | 89 total · 71 code · 0 comments |

#### 📄 `server.js`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| **Type** | JS |
| **Lines** | 165 total · 128 code · 9 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `base64url(buf)` | — |
| `getAccessToken()` | ✅ |
| `fetch(...)` | — |

**Express Routes:**

| Method | Path |
|--------|------|
| `GET` | `/exam` |
| `GET` | `/api/sheet` |
| `PUT` | `/api/sheet/:rowIndex` |
| `POST` | `/api/upload` |
| `GET` | `/api/config` |

### 📁 `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/public/`

#### 📄 `exam.html`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/public/exam.html` |
| **Type** | HTML |
| **Lines** | 1192 total · 1067 code · 48 comments |

**Page title:** Exam Details
**Inline `<script>` blocks:** 2  ·  **`<style>` blocks:** 1

#### 📄 `index.html`

| Property | Value |
|----------|-------|
| **Path** | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/public/index.html` |
| **Type** | HTML |
| **Lines** | 553 total · 486 code · 22 comments |

**Page title:** Exam Tracker
**Inline `<script>` blocks:** 1  ·  **`<style>` blocks:** 1

**JavaScript functions defined inside this page:**

| Function | Async |
|----------|-------|
| `boot()` | ✅ |
| `loadSheet()` | ✅ |
| `showDashboard()` | — |
| `colIdx(name)` | — |
| `cell(row, n)` | — |
| `setCell(row, n, v)` | — |
| `getMissing(row)` | — |
| `isComplete(row)` | — |
| `renderStats()` | — |
| `populateFilters()` | — |
| `getFiltered()` | — |
| `wilayaBadge(w)` | — |
| `renderTable()` | — |
| `shareExam(id, e)` | — |
| `openFill(idx)` | — |
| `handleFileSelect(input)` | — |
| `handleDrop(e)` | — |
| `setFile(f)` | — |
| `saveRow()` | ✅ |
| `closeModal()` | — |
| `setSyncStatus(state,label)` | — |
| `notify(msg,type)` | — |

### 📁 `public/`

#### 📄 `digitizePrompt.js`

| Property | Value |
|----------|-------|
| **Path** | `public/digitizePrompt.js` |
| **Type** | JS |
| **Lines** | 107 total · 95 code · 0 comments |

#### 📄 `doubleCheckPrompt.js`

| Property | Value |
|----------|-------|
| **Path** | `public/doubleCheckPrompt.js` |
| **Type** | JS |
| **Lines** | 113 total · 99 code · 0 comments |

**Functions:**

| Function | Async |
|----------|-------|
| `generateDoubleCheckPromptFromContext(data, tsvData)` | — |
| `generateDoubleCheckPrompt(arg1, arg2)` | — |

#### 📄 `exam.html`

| Property | Value |
|----------|-------|
| **Path** | `public/exam.html` |
| **Type** | HTML |
| **Lines** | 1692 total · 1504 code · 52 comments |

**Page title:** Exam Details
**Inline `<script>` blocks:** 4  ·  **`<style>` blocks:** 1

#### 📄 `EXAM_DATA.md`

| Property | Value |
|----------|-------|
| **Path** | `public/EXAM_DATA.md` |
| **Type** | MD |
| **Lines** | 292 total · 242 code · 0 comments |

#### 📄 `index.html`

| Property | Value |
|----------|-------|
| **Path** | `public/index.html` |
| **Type** | HTML |
| **Lines** | 827 total · 711 code · 40 comments |

**Page title:** Exam Tracker
**Inline `<script>` blocks:** 1  ·  **`<style>` blocks:** 1

**JavaScript functions defined inside this page:**

| Function | Async |
|----------|-------|
| `toDateInputValue(str)` | — |
| `parseAnnotations(str)` | — |
| `annotationsToString(tags)` | — |
| `tsvToCsv(tsv)` | — |
| `parseRangeInput(str)` | — |
| `boot()` | ✅ |
| `loadSheet()` | ✅ |
| `showDashboard()` | — |
| `colIdx(name)` | — |
| `cell(row, n)` | — |
| `setCell(row, n, v)` | — |
| `parseTags(row)` | — |
| `getMissing(row)` | — |
| `isComplete(row)` | — |
| `renderStats()` | — |
| `populateFilters()` | — |
| `getFiltered()` | — |
| `wilayaBadge(w)` | — |
| `renderTable()` | — |
| `shareExam(id, e)` | — |
| `openFill(idx)` | — |
| `handleFileSelect(input)` | — |
| `handleDrop(e)` | — |
| `setFile(f)` | — |
| `saveRow()` | ✅ |
| `closeModal()` | — |
| `setSyncStatus(state,label)` | — |
| `notify(msg,type)` | — |

#### 📄 `PROMPT_EDITING_RULES.md`

| Property | Value |
|----------|-------|
| **Path** | `public/PROMPT_EDITING_RULES.md` |
| **Type** | MD |
| **Lines** | 92 total · 71 code · 0 comments |

#### 📄 `_tmp_exam_inline_check.js`

| Property | Value |
|----------|-------|
| **Path** | `public/_tmp_exam_inline_check.js` |
| **Type** | JS |
| **Lines** | 1128 total · 998 code · 27 comments |

---

## 🌐 API ENDPOINTS

| Method | Path | File |
|--------|------|------|
| `GET` | `/exam` | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| `GET` | `/api/sheet` | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| `PUT` | `/api/sheet/:rowIndex` | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| `POST` | `/api/upload` | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| `GET` | `/api/config` | `00- Archive/codex-backup-2026-04-01-update-from-Exam-Tracker-VF/server.js` |
| `GET` | `/exam` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `GET` | `/api/sheet` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `PUT` | `/api/sheet/:rowIndex` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `POST` | `/api/upload` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `GET` | `/api/drive-download` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `GET` | `/api/config` | `00- Archive/Exam-Tracker-VF- Replit 50 dollars/Exam-Tracker-VF/server.js` |
| `GET` | `/exam` | `server.js` |
| `GET` | `/api/sheet` | `server.js` |
| `PUT` | `/api/sheet/:rowIndex` | `server.js` |
| `POST` | `/api/upload` | `server.js` |
| `POST` | `/api/report-pdf` | `server.js` |
| `GET` | `/api/drive-download` | `server.js` |
| `GET` | `/api/config` | `server.js` |

---

## 🔗 DEPENDENCY GRAPH

Local module dependencies within the project:

**`adminReportPdf.js`** depends on:
- `./reportPdfShared`

**`publicReportPdf.js`** depends on:
- `./reportPdfShared`

**`server.js`** depends on:
- `./reportPdfShared`
- `./adminReportPdf`
- `./publicReportPdf`

---

## ⚙️ CONFIGURATION & ENVIRONMENT

All credentials are stored in environment variables (`.env` locally, Railway Variables in production).

| Variable | Description | Default |
|----------|-------------|---------|
| `SHEET_ID` | Google Sheets spreadsheet ID | — |
| `SHEET_TAB` | Sheet tab name | `Exams_Tracking` |
| `HEADER_ROW` | Row number of the header row | `1` |
| `DRIVE_FOLDER_ID` | Google Drive folder for uploads | — |
| `SERVICE_ACCOUNT_JSON` | Full JSON of the Google service account | — |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID for frontend sign-in | — |
| `PORT` | HTTP server port | `3000` |

---

## 📝 FILE NAMING CONVENTIONS

### JavaScript Files
- **Modules:** `camelCase.js`
- **Classes (inside modules):** `PascalCase`
- **Functions:** `camelCase()`
- **Constants:** `UPPER_SNAKE_CASE`

### Auto-Fix Scripts
- **Format:** `autofix_<description>_<YYYYMMDD_HHMMSS>.js`
- **Example:** `autofix_update_prompt_20260404_143022.js`
- **Location:** Project root (next to `server.js`)

### Backup Folders
- **Format:** `backup_<YYYY-MM-DDTHH-MM-SS>/`
- **Location:** `0-Archive/backups/`

### Upload Files (Google Drive)
- **Exam PDF:** `Wilaya_Year_PR_Module_CT_NQQ_Nmiss_V1.pdf`
- **QCM CSV:** `Wilaya_Year_PR_Module_QCM_V1.csv`
- **Admin Report:** `Wilaya_Level_Module_YYRef_Admin_Report_V1.pdf`
- **Public Report:** `Wilaya_Level_Module_YYRef_Public_Report_V1.pdf`

---

## 🛡️ SAFETY FEATURES

### Automatic Backups

Every file modification through auto-fix scripts includes:

- ✅ **Timestamped backups** — Each backup has a unique timestamp
- ✅ **Original files preserved** — No data loss
- ✅ **Organized structure** — All backups in `0-Archive/backups/`
- ✅ **Easy rollback** — Simple copy-back process

### Rollback Procedure

```javascript
const fs   = require('fs');
const path = require('path');
// 1. Identify the backup folder
const BACKUP = path.join(__dirname, '0-Archive', 'backups', 'backup_2026-04-04T14-30-22');
// 2. Copy files back
for (const file of fs.readdirSync(BACKUP)) {
  fs.copyFileSync(path.join(BACKUP, file), path.join(__dirname, file));
  console.log('Restored:', file);
}
```

---

## 🔧 TROUBLESHOOTING

### Common Issues

#### Issue: `Cannot find module` error after running auto-fix script
**Solution:** `npm install`

#### Issue: Google API 403 / permission denied
**Solution:** Ensure the service account is shared on the target Sheet and Drive folder.

#### Issue: `DRIVE_FOLDER_ID is not set` error on upload
**Solution:** Set `DRIVE_FOLDER_ID` in your `.env` file or Railway Variables.

#### Issue: Exam not found on detail page
**Solution:** Check that the `?id=` URL param matches exactly the `ID_Exams` column value.

#### Issue: Prompt Step 2 fails to parse Step 1 output
**Solution:** The Step 1 TSV block must start with the header line and contain no prose. Check `digitizePrompt.js`.

---

## 🛠️ DEVELOPMENT GUIDELINES

### Code Style

- Vanilla JS only on the frontend — no frameworks
- `require()` for all server-side imports (CommonJS)
- Use `async/await` for all asynchronous operations
- Keep prompt text in the split prompt files, never in `exam.html`
- Keep PDF layout logic in the backend report files, never in the frontend

### Prompt & Report Architecture

| File | Responsibility |
|------|---------------|
| `public/prompts/digitizePrompt.js` | Step 1 extraction prompt only |
| `public/prompts/doubleCheckPrompt.js` | Step 2 verification prompt only |
| `reports/adminReportPdf.js` | Admin/internal PDF layout |
| `reports/publicReportPdf.js` | Student-facing PDF layout |
| `reports/reportPdfShared.js` | Shared PDF engine, colors, helpers |
| `server.js` | Express backend, Google API proxy, report endpoint |
| `public/index.html` | Dashboard: stats, filters, table |
| `public/exam.html` | Exam detail page: data entry, upload, prompts |

### Adding New Features

1. Analyze existing code structure
2. Follow established patterns
3. Regenerate documentation: `node docs/project_doc_generator.js`
4. Update `package.json` if adding new npm packages
5. Create a backup before making any changes

---

## 📋 VERSION HISTORY

**Current Version:** 1.0.0

### Recent Changes

**1.0.0** (2026-04-04)
- Dynamic documentation generator added (`project_doc_generator.js`)
- Auto-generated Admin and Public PDF reports
- Split prompt architecture (`digitizePrompt.js`, `doubleCheckPrompt.js`)
- Shared PDF engine (`reportPdfShared.js`)
- Railway deployment configuration

---

## 📚 ADDITIONAL RESOURCES

- **Schema reference:** `docs/SCHEMA.md`
- **Exam data & report architecture:** `docs/EXAM_DATA.md`
- **Prompt editing rules:** `docs/PROMPT_EDITING_RULES.md`
- **Backups:** `0-Archive/backups/`

### Useful Links

- Node.js Documentation: https://nodejs.org/docs/
- Google Sheets API v4: https://developers.google.com/sheets/api
- Google Drive API v3: https://developers.google.com/drive/api
- Railway Deployment: https://railway.app/

---

*Documentation generated on 2026-04-04 at 13:55:51*

*Generator Version: 2.0*

*Total documentation size: 11 655 lines analyzed*
