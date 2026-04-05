#!/usr/bin/env node
/**
 * Enhanced Project Documentation Generator - Exam Tracker v2.0
 * Generates comprehensive project documentation for AI model understanding.
 * Mirrors the structure and conventions of the Python project_doc_generator.py.
 *
 * Usage:
 *   node docs/project_doc_generator.js
 *   node docs/project_doc_generator.js --json
 *   node docs/project_doc_generator.js --project-root /path/to/project
 *   node docs/project_doc_generator.js --version 1.2.0
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const getArg      = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const hasFlag     = (flag) => args.includes(flag);

const PROJECT_ROOT = getArg("--project-root") || process.cwd();
const VERSION      = getArg("--version")       || "1.0.0";
const EXPORT_JSON  = hasFlag("--json");
const PROJECT_NAME = path.basename(PROJECT_ROOT);

// ─────────────────────────────────────────────────────────────────────────────
// Config — what to scan and what to skip
// ─────────────────────────────────────────────────────────────────────────────
const SCAN_EXTENSIONS = [".js", ".html", ".md", ".json", ".toml"];
const SKIP_DIRS       = new Set(["node_modules", ".git", "attached_assets", "0- Archive"]);
const SKIP_FILES      = new Set(["package-lock.json"]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function now() {
  return new Date().toISOString().replace("T", " at ").slice(0, 22);
}

function relPath(absPath) {
  return path.relative(PROJECT_ROOT, absPath).replace(/\\/g, "/");
}

/** Recursively walk the project and collect files matching SCAN_EXTENSIONS. */
function walkProject(dir, collected = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return collected; }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && !entry.name.startsWith(".git")) continue; // keep .gitignore etc only if needed
    if (SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProject(full, collected);
    } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      collected.push(full);
    }
  }
  return collected;
}

function readFile(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

// ─────────────────────────────────────────────────────────────────────────────
// JS analysis helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract top-level function declarations and function expressions assigned to const/let/var. */
function extractJsFunctions(source) {
  const funcs = [];
  // function foo(...) { and async function foo(...) {
  const declRe = /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/gm;
  let m;
  while ((m = declRe.exec(source)) !== null) {
    funcs.push({ name: m[1], params: m[2].trim(), isAsync: source.slice(m.index, m.index + 6) === "async " });
  }
  // const foo = (async) function(...) or arrow (...)=>
  const assignRe = /^(?:const|let|var)\s+(\w+)\s*=\s*(async\s+)?(?:function|\()/gm;
  while ((m = assignRe.exec(source)) !== null) {
    if (!funcs.find(f => f.name === m[1])) {
      funcs.push({ name: m[1], params: "...", isAsync: !!m[2] });
    }
  }
  return funcs;
}

/** Extract class definitions. */
function extractJsClasses(source) {
  const classes = [];
  const re = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    classes.push({ name: m[1], base: m[2] || null });
  }
  return classes;
}

/** Extract require() calls and import statements. */
function extractJsDependencies(source) {
  const deps = new Set();
  const requireRe = /require\(['"]([^'"]+)['"]\)/g;
  const importRe  = /^import\s+.*?from\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = requireRe.exec(source)) !== null) deps.add(m[1]);
  while ((m = importRe.exec(source)) !== null)  deps.add(m[1]);
  return [...deps];
}

/** Extract module.exports keys. */
function extractExports(source) {
  const exports = [];
  const re = /module\.exports\s*=\s*\{([^}]+)\}/s;
  const m = re.exec(source);
  if (m) {
    const keys = m[1].match(/\b(\w+)\b(?=\s*[:,\n])/g) || [];
    exports.push(...new Set(keys));
  }
  // module.exports.foo = ...
  const singleRe = /module\.exports\.(\w+)\s*=/g;
  let sm;
  while ((sm = singleRe.exec(source)) !== null) {
    if (!exports.includes(sm[1])) exports.push(sm[1]);
  }
  return exports;
}

/** Extract Express route definitions. */
function extractRoutes(source) {
  const routes = [];
  const re = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return routes;
}

/** Count lines, comment lines, and blank lines. */
function countLines(source) {
  const lines   = source.split(/\r?\n/);
  const total   = lines.length;
  const comment = lines.filter(l => l.trim().startsWith("//") || l.trim().startsWith("*") || l.trim().startsWith("/*")).length;
  const blank   = lines.filter(l => !l.trim()).length;
  return { total, comment, blank, code: total - comment - blank };
}

/** Extract the first JSDoc or block comment from a file. */
function extractFileDocstring(source) {
  const m = source.match(/^\/\*\*?([\s\S]*?)\*\//);
  if (!m) return "";
  return m[1].replace(/^\s*\*\s?/gm, "").trim().split("\n")[0].trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML analysis
// ─────────────────────────────────────────────────────────────────────────────
function analyzeHtml(source) {
  const scripts = (source.match(/<script[\s\S]*?<\/script>/gi) || []).length;
  const styles  = (source.match(/<style[\s\S]*?<\/style>/gi)  || []).length;
  // function declarations inside <script>
  const inlineFns = extractJsFunctions(source);
  const title = (source.match(/<title>([^<]+)<\/title>/i) || [])[1] || "";
  return { scripts, styles, inlineFns, title };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON/TOML: simple key extraction
// ─────────────────────────────────────────────────────────────────────────────
function analyzePackageJson(source) {
  try {
    const pkg = JSON.parse(source);
    return {
      name:         pkg.name    || "",
      version:      pkg.version || "",
      description:  pkg.description || "",
      main:         pkg.main    || "",
      scripts:      Object.keys(pkg.scripts    || {}),
      dependencies: Object.keys(pkg.dependencies || {}),
      devDeps:      Object.keys(pkg.devDependencies || {}),
    };
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scanner
// ─────────────────────────────────────────────────────────────────────────────
function scanProject() {
  const files   = walkProject(PROJECT_ROOT);
  const modules = {};
  const stats   = { totalFiles: 0, totalLines: 0, totalComments: 0, totalFunctions: 0, totalClasses: 0, totalRoutes: 0 };
  const externalPackages = new Set();
  const localModules = new Set();
  let packageMeta = null;
  const routes = [];

  for (const filePath of files) {
    const rel  = relPath(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const src  = readFile(filePath);
    if (!src) continue;

    stats.totalFiles++;
    const lc = countLines(src);
    stats.totalLines    += lc.total;
    stats.totalComments += lc.comment;

    const info = {
      path:      rel,
      ext,
      lines:     lc,
      docstring: "",
      functions: [],
      classes:   [],
      deps:      [],
      exports:   [],
      routes:    [],
      html:      null,
      pkg:       null,
    };

    if (ext === ".js") {
      info.docstring = extractFileDocstring(src);
      info.functions = extractJsFunctions(src);
      info.classes   = extractJsClasses(src);
      info.deps      = extractJsDependencies(src);
      info.exports   = extractExports(src);
      const fileRoutes = extractRoutes(src);
      info.routes    = fileRoutes;
      routes.push(...fileRoutes.map(r => ({ ...r, file: rel })));

      stats.totalFunctions += info.functions.length;
      stats.totalClasses   += info.classes.length;
      stats.totalRoutes    += fileRoutes.length;

      for (const dep of info.deps) {
        if (dep.startsWith(".")) localModules.add(dep);
        else                     externalPackages.add(dep.split("/")[0]);
      }
    }

    if (ext === ".html") {
      info.html = analyzeHtml(src);
      stats.totalFunctions += (info.html.inlineFns || []).length;
    }

    if (rel === "package.json") {
      info.pkg    = analyzePackageJson(src);
      packageMeta = info.pkg;
    }

    modules[rel] = info;
  }

  return { modules, stats, externalPackages, localModules, packageMeta, routes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency graph
// ─────────────────────────────────────────────────────────────────────────────
function buildDepGraph(modules) {
  const graph = {};
  for (const [rel, info] of Object.entries(modules)) {
    if (info.ext !== ".js") continue;
    const deps = info.deps.filter(d => d.startsWith("./") || d.startsWith("../"));
    if (deps.length) graph[rel] = deps;
  }
  return graph;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASCII tree builder
// ─────────────────────────────────────────────────────────────────────────────
function buildTree(modules) {
  const tree = {};
  for (const rel of Object.keys(modules).sort()) {
    const parts = rel.split("/");
    let cursor = tree;
    for (const part of parts) {
      if (!cursor[part]) cursor[part] = {};
      cursor = cursor[part];
    }
  }
  function render(node, prefix = "") {
    const entries = Object.entries(node);
    const lines   = [];
    entries.forEach(([name, sub], i) => {
      const isLast    = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const hasChildren = Object.keys(sub).length > 0;
      lines.push(`${prefix}${connector}${hasChildren ? "📁 " : "📄 "}${name}`);
      if (hasChildren) {
        lines.push(...render(sub, prefix + (isLast ? "    " : "│   ")));
      }
    });
    return lines;
  }
  return [PROJECT_NAME + "/", ...render(tree)].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown generation
// ─────────────────────────────────────────────────────────────────────────────
function generateMarkdown(data) {
  const { modules, stats, externalPackages, packageMeta, routes, depGraph } = data;
  const generated = now();
  const pkg       = packageMeta || {};

  const lines = [];
  const h  = (...s) => lines.push(s.join(" "));
  const p  = (...s) => lines.push(s.join(" "));
  const br = ()     => lines.push("");
  const hr = ()     => lines.push("---");

  // ── Header ────────────────────────────────────────────────────────────────
  h(`# 📚 ${pkg.name || PROJECT_NAME} — PROJECT DOCUMENTATION`); br();
  p(`**Generated:** ${generated}`); br();
  p(`**Version:** ${pkg.version || VERSION}`); br();
  p(`**Project Root:** \`${PROJECT_ROOT}\``); br();
  hr(); br();

  // ── Table of contents ─────────────────────────────────────────────────────
  h("## 📑 TABLE OF CONTENTS"); br();
  [
    "1. [Project Overview](#-project-overview)",
    "2. [Quick Start Guide](#-quick-start-guide)",
    "3. [🚨 CRITICAL: AI File Modification Rules](#-critical-ai-file-modification-rules)",
    "4. [Project Statistics](#-project-statistics)",
    "5. [Project Structure](#-project-structure)",
    "6. [External Dependencies](#-external-dependencies)",
    "7. [Module Documentation](#-module-documentation)",
    "8. [API Endpoints](#-api-endpoints)",
    "9. [Dependency Graph](#-dependency-graph)",
    "10. [Configuration & Environment](#-configuration--environment)",
    "11. [File Naming Conventions](#-file-naming-conventions)",
    "12. [Safety Features](#️-safety-features)",
    "13. [Troubleshooting](#-troubleshooting)",
    "14. [Development Guidelines](#-development-guidelines)",
    "15. [Version History](#-version-history)",
    "16. [Additional Resources](#-additional-resources)",
  ].forEach(l => p(l));
  br(); hr(); br();

  // ── Project overview ──────────────────────────────────────────────────────
  h("## 🎯 PROJECT OVERVIEW"); br();
  h(`### What is ${pkg.name || PROJECT_NAME}?`); br();
  p(pkg.description || "A web-based dashboard for tracking medical exam digitization data."); br();
  p("This project provides:"); br();
  p("- Web dashboard for managing and tracking exam digitization progress");
  p("- Google Sheets as the database backend (no SQL server required)");
  p("- Google Drive for PDF and CSV file storage");
  p("- AI-assisted prompt generation for QCM digitization workflows");
  p("- Auto-generated Admin and Public PDF reports");
  br();
  p(`**Project Location:**`); br();
  p("```"); p(PROJECT_ROOT); p("```"); br();
  hr(); br();

  // ── Quick start ───────────────────────────────────────────────────────────
  h("## 🚀 QUICK START GUIDE"); br();
  h("### Prerequisites"); br();
  p("- Node.js 18 or higher"); p("- npm package manager"); p("- Google service account with Sheets + Drive access");
  br();
  h("### First Time Setup"); br();
  p("1. **Install dependencies**");
  p("   ```bash"); p("   npm install"); p("   ```"); br();
  p("2. **Configure environment variables**");
  p("   Create a `.env` file at the project root (see Configuration section)"); br();
  p("3. **Run the application**");
  p("   ```bash"); p("   node server.js"); p("   # or"); p("   npm start"); p("   ```"); br();
  h("### Quick Commands"); br();
  p("```bash");
  p("# Install dependencies"); p("npm install"); br();
  p("# Start the server"); p("npm start"); br();
  p("# Regenerate documentation"); p("node project_doc_generator.js"); br();
  p("# Regenerate with JSON export"); p("node project_doc_generator.js --json");
  p("```"); br();
  hr(); br();

  // ── AI file modification rules ────────────────────────────────────────────
  h("## 🚨 CRITICAL: AI FILE MODIFICATION RULES"); br();
  p("> **🔴 SEVERITY LEVEL: CRITICAL**");
  p("> **⚠️ NON-COMPLIANCE WILL RESULT IN DATA LOSS**");
  p("> **📖 READ COMPLETELY BEFORE ANY MODIFICATIONS**");
  br();
  h("### ⚠️ MANDATORY REQUIREMENTS FOR ALL FILE MODIFICATIONS"); br();
  h("#### 1️⃣ Auto-Fix Script Requirement"); br();
  p("**When ANY file modification is requested, you MUST:**"); br();
  p("- Create a standalone Node.js script for the modification");
  p("- Script must be placed in the main directory (next to `server.js`)");
  p("- Script name format: `autofix_<description>_<timestamp>.js`");
  p("  - Example: `autofix_update_prompt_20260404_143022.js`");
  br();
  p("**Script Requirements:**");
  p("```javascript");
  p(`/**`);
  p(` * Auto-fix script template`);
  p(` * Purpose: [Brief description]`);
  p(` * Created: [Date and time]`);
  p(` */`);
  p(`const fs   = require('fs');`);
  p(`const path = require('path');`);
  br();
  p(`const BACKUP_BASE = path.join(__dirname, '0-Archive', 'backups');`);
  p(`const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);`);
  p(`const BACKUP_DIR  = path.join(BACKUP_BASE, 'backup_' + ts);`);
  br();
  p(`const FILES_TO_MODIFY = ['server.js', 'public/exam.html'];`);
  br();
  p(`function createBackup() {`);
  p(`  fs.mkdirSync(BACKUP_DIR, { recursive: true });`);
  p(`  for (const f of FILES_TO_MODIFY) {`);
  p(`    if (fs.existsSync(f)) {`);
  p(`      fs.copyFileSync(f, path.join(BACKUP_DIR, path.basename(f)));`);
  p(`      console.log('  ✓ Backed up:', f);`);
  p(`    }`);
  p(`  }`);
  p(`}`);
  br();
  p(`function applyModifications() {`);
  p(`  // YOUR MODIFICATION CODE HERE`);
  p(`}`);
  br();
  p(`createBackup();`);
  p(`applyModifications();`);
  p(`console.log('✅ Auto-fix completed!');`);
  p("```"); br();

  h("#### 2️⃣ Backup Directory Structure (MANDATORY)"); br();
  p("```");
  p(`${PROJECT_ROOT}/0-Archive/backups/`);
  p("├── backup_2026-04-04T14-30-22/");
  p("│   ├── server.js");
  p("│   └── exam.html");
  p("└── backup_2026-04-05T09-12-00/");
  p("    └── digitizePrompt.js");
  p("```"); br();
  p("**⚠️ CRITICAL RULES:**");
  p("- ✅ **DO:** Create timestamped subfolder (format: `backup_YYYY-MM-DDTHH-MM-SS`)");
  p("- ✅ **DO:** Place ALL modified files inside the timestamped subfolder");
  p("- ❌ **DON'T:** Put files directly in the backups folder");
  p("- ❌ **DON'T:** Create backups anywhere else");
  br();
  h("#### 3️⃣ Response Format (REQUIRED)"); br();
  p("- Provide ONLY the auto-fix script — no long explanations");
  p("- One line of instruction: `Place next to server.js and run: node autofix_xxx.js`");
  p("- Detailed docs only if the user explicitly asks for them");
  br();
  h("#### 4️⃣ Prompt and Report File Rules"); br();
  p("When editing prompts or report PDFs, follow `PROMPT_EDITING_RULES.md` and `EXAM_DATA.md`.");
  p("Stable exported function names — **never rename without updating all callers:**");
  p("- `generateDigitizePrompt`");
  p("- `generateDoubleCheckPromptFromContext`");
  p("- `generateDoubleCheckPrompt`");
  p("- `buildAdminReportBuffer`");
  p("- `buildPublicReportBuffer`");
  p("- `buildReportContext`");
  br();
  h("### 📋 QUICK REFERENCE CHECKLIST"); br();
  p("```");
  p("✓ [ ] Created Node.js auto-fix script");
  p("✓ [ ] Script includes backup creation code");
  p("✓ [ ] Backup uses timestamped subfolder");
  p("✓ [ ] Script name includes timestamp");
  p("✓ [ ] Response is concise (no unnecessary detail)");
  p("✓ [ ] Stable function names preserved");
  p("```");
  br(); hr(); br();

  // ── Statistics ────────────────────────────────────────────────────────────
  h("## 📊 PROJECT STATISTICS"); br();
  p(`- **Total Files Scanned:** ${stats.totalFiles}`);
  p(`- **Total Classes:** ${stats.totalClasses}`);
  p(`- **Total Functions:** ${stats.totalFunctions}`);
  p(`- **Total Lines of Code:** ${stats.totalLines.toLocaleString()}`);
  p(`- **Comment Lines:** ${stats.totalComments.toLocaleString()}`);
  p(`- **API Routes:** ${stats.totalRoutes}`);
  p(`- **External Dependencies:** ${externalPackages.size}`);
  br(); hr(); br();

  // ── Project structure ─────────────────────────────────────────────────────
  h("## 📁 PROJECT STRUCTURE"); br();
  p("```"); p(buildTree(modules)); p("```"); br();
  hr(); br();

  // ── External dependencies ─────────────────────────────────────────────────
  h("## 📦 EXTERNAL DEPENDENCIES"); br();
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
    h("### Runtime Dependencies (package.json)"); br();
    p("| Package | Version |");
    p("|---------|---------|");
    for (const [name, ver] of Object.entries(pkg.dependencies)) {
      p(`| \`${name}\` | ${ver} |`);
    }
    br();
  }
  if (externalPackages.size) {
    h("### All Detected External Imports"); br();
    p([...externalPackages].sort().map(d => `\`${d}\``).join("  ·  ")); br();
  }
  hr(); br();

  // ── Module documentation ──────────────────────────────────────────────────
  h("## 🗂️ MODULE DOCUMENTATION"); br();

  // Group modules by directory
  const byDir = {};
  for (const [rel, info] of Object.entries(modules)) {
    const dir = path.dirname(rel);
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push([rel, info]);
  }

  for (const [dir, entries] of Object.entries(byDir).sort()) {
    h(`### 📁 \`${dir === "." ? "/ (root)" : dir}/\``); br();
    for (const [rel, info] of entries) {
      const fname = path.basename(rel);
      h(`#### 📄 \`${fname}\``); br();

      // File meta
      p(`| Property | Value |`);
      p(`|----------|-------|`);
      p(`| **Path** | \`${rel}\` |`);
      p(`| **Type** | ${info.ext.slice(1).toUpperCase()} |`);
      p(`| **Lines** | ${info.lines.total} total · ${info.lines.code} code · ${info.lines.comment} comments |`);
      br();

      if (info.docstring) {
        p(`> ${info.docstring}`); br();
      }

      // HTML files
      if (info.html) {
        const { title, scripts, styles, inlineFns } = info.html;
        if (title) p(`**Page title:** ${title}`);
        p(`**Inline \`<script>\` blocks:** ${scripts}  ·  **\`<style>\` blocks:** ${styles}`);
        if (inlineFns.length) {
          br(); p("**JavaScript functions defined inside this page:**"); br();
          p("| Function | Async |");
          p("|----------|-------|");
          for (const f of inlineFns) {
            p(`| \`${f.name}(${f.params})\` | ${f.isAsync ? "✅" : "—"} |`);
          }
        }
        br();
      }

      // JS files
      if (info.ext === ".js") {
        if (info.classes.length) {
          p("**Classes:**"); br();
          p("| Class | Extends |");
          p("|-------|---------|");
          for (const c of info.classes) {
            p(`| \`${c.name}\` | ${c.base ? `\`${c.base}\`` : "—"} |`);
          }
          br();
        }

        if (info.functions.length) {
          p("**Functions:**"); br();
          p("| Function | Async |");
          p("|----------|-------|");
          for (const f of info.functions) {
            p(`| \`${f.name}(${f.params})\` | ${f.isAsync ? "✅" : "—"} |`);
          }
          br();
        }

        if (info.routes.length) {
          p("**Express Routes:**"); br();
          p("| Method | Path |");
          p("|--------|------|");
          for (const r of info.routes) {
            p(`| \`${r.method}\` | \`${r.path}\` |`);
          }
          br();
        }

        if (info.exports.length) {
          p(`**Exports:** ${info.exports.map(e => `\`${e}\``).join("  ·  ")}`); br();
        }

        if (info.deps.filter(d => d.startsWith(".")).length) {
          p(`**Local imports:** ${info.deps.filter(d => d.startsWith(".")).map(d => `\`${d}\``).join("  ·  ")}`); br();
        }
      }

      // package.json
      if (info.pkg) {
        p(`**Scripts:** ${info.pkg.scripts.map(s => `\`${s}\``).join("  ·  ")}`); br();
      }
    }
  }
  hr(); br();

  // ── API endpoints ─────────────────────────────────────────────────────────
  h("## 🌐 API ENDPOINTS"); br();
  if (routes.length) {
    p("| Method | Path | File |");
    p("|--------|------|------|");
    for (const r of routes) {
      p(`| \`${r.method}\` | \`${r.path}\` | \`${r.file}\` |`);
    }
  } else {
    p("No Express routes detected.");
  }
  br(); hr(); br();

  // ── Dependency graph ──────────────────────────────────────────────────────
  h("## 🔗 DEPENDENCY GRAPH"); br();
  p("Local module dependencies within the project:"); br();
  const graph = depGraph || {};
  if (Object.keys(graph).length) {
    for (const [file, deps] of Object.entries(graph)) {
      p(`**\`${file}\`** depends on:`);
      deps.forEach(d => p(`- \`${d}\``));
      br();
    }
  } else {
    p("No local cross-dependencies detected."); br();
  }
  hr(); br();

  // ── Configuration ─────────────────────────────────────────────────────────
  h("## ⚙️ CONFIGURATION & ENVIRONMENT"); br();
  p("All credentials are stored in environment variables (`.env` locally, Railway Variables in production)."); br();
  p("| Variable | Description | Default |");
  p("|----------|-------------|---------|");
  p("| `SHEET_ID` | Google Sheets spreadsheet ID | — |");
  p("| `SHEET_TAB` | Sheet tab name | `Exams_Tracking` |");
  p("| `HEADER_ROW` | Row number of the header row | `1` |");
  p("| `DRIVE_FOLDER_ID` | Google Drive folder for uploads | — |");
  p("| `SERVICE_ACCOUNT_JSON` | Full JSON of the Google service account | — |");
  p("| `GOOGLE_CLIENT_ID` | Google OAuth client ID for frontend sign-in | — |");
  p("| `PORT` | HTTP server port | `3000` |");
  br(); hr(); br();

  // ── File naming conventions ───────────────────────────────────────────────
  h("## 📝 FILE NAMING CONVENTIONS"); br();
  h("### JavaScript Files");
  p("- **Modules:** `camelCase.js`");
  p("- **Classes (inside modules):** `PascalCase`");
  p("- **Functions:** `camelCase()`");
  p("- **Constants:** `UPPER_SNAKE_CASE`");
  br();
  h("### Auto-Fix Scripts");
  p("- **Format:** `autofix_<description>_<YYYYMMDD_HHMMSS>.js`");
  p("- **Example:** `autofix_update_prompt_20260404_143022.js`");
  p("- **Location:** Project root (next to `server.js`)");
  br();
  h("### Backup Folders");
  p("- **Format:** `backup_<YYYY-MM-DDTHH-MM-SS>/`");
  p("- **Location:** `0-Archive/backups/`");
  br();
  h("### Upload Files (Google Drive)");
  p("- **Exam PDF:** `Wilaya_Year_PR_Module_CT_NQQ_Nmiss_V1.pdf`");
  p("- **QCM CSV:** `Wilaya_Year_PR_Module_QCM_V1.csv`");
  p("- **Admin Report:** `Wilaya_Level_Module_YYRef_Admin_Report_V1.pdf`");
  p("- **Public Report:** `Wilaya_Level_Module_YYRef_Public_Report_V1.pdf`");
  br(); hr(); br();

  // ── Safety features ───────────────────────────────────────────────────────
  h("## 🛡️ SAFETY FEATURES"); br();
  h("### Automatic Backups"); br();
  p("Every file modification through auto-fix scripts includes:"); br();
  p("- ✅ **Timestamped backups** — Each backup has a unique timestamp");
  p("- ✅ **Original files preserved** — No data loss");
  p("- ✅ **Organized structure** — All backups in `0-Archive/backups/`");
  p("- ✅ **Easy rollback** — Simple copy-back process");
  br();
  h("### Rollback Procedure"); br();
  p("```javascript");
  p("const fs   = require('fs');");
  p("const path = require('path');");
  p("// 1. Identify the backup folder");
  p("const BACKUP = path.join(__dirname, '0-Archive', 'backups', 'backup_2026-04-04T14-30-22');");
  p("// 2. Copy files back");
  p("for (const file of fs.readdirSync(BACKUP)) {");
  p("  fs.copyFileSync(path.join(BACKUP, file), path.join(__dirname, file));");
  p("  console.log('Restored:', file);");
  p("}");
  p("```");
  br(); hr(); br();

  // ── Troubleshooting ───────────────────────────────────────────────────────
  h("## 🔧 TROUBLESHOOTING"); br();
  h("### Common Issues"); br();
  p("#### Issue: `Cannot find module` error after running auto-fix script");
  p("**Solution:** `npm install`"); br();
  p("#### Issue: Google API 403 / permission denied");
  p("**Solution:** Ensure the service account is shared on the target Sheet and Drive folder."); br();
  p("#### Issue: `DRIVE_FOLDER_ID is not set` error on upload");
  p("**Solution:** Set `DRIVE_FOLDER_ID` in your `.env` file or Railway Variables."); br();
  p("#### Issue: Exam not found on detail page");
  p("**Solution:** Check that the `?id=` URL param matches exactly the `ID_Exams` column value."); br();
  p("#### Issue: Prompt Step 2 fails to parse Step 1 output");
  p("**Solution:** The Step 1 TSV block must start with the header line and contain no prose. Check `digitizePrompt.js`."); br();
  hr(); br();

  // ── Development guidelines ────────────────────────────────────────────────
  h("## 🛠️ DEVELOPMENT GUIDELINES"); br();
  h("### Code Style"); br();
  p("- Vanilla JS only on the frontend — no frameworks");
  p("- `require()` for all server-side imports (CommonJS)");
  p("- Use `async/await` for all asynchronous operations");
  p("- Keep prompt text in the split prompt files, never in `exam.html`");
  p("- Keep PDF layout logic in the backend report files, never in the frontend");
  br();
  h("### Prompt & Report Architecture"); br();
  p("| File | Responsibility |");
  p("|------|---------------|");
  p("| `public/prompts/digitizePrompt.js` | Step 1 extraction prompt only |");
  p("| `public/prompts/doubleCheckPrompt.js` | Step 2 verification prompt only |");
  p("| `reports/adminReportPdf.js` | Admin/internal PDF layout |");
  p("| `reports/publicReportPdf.js` | Student-facing PDF layout |");
  p("| `reports/reportPdfShared.js` | Shared PDF engine, colors, helpers |");
  p("| `server.js` | Express backend, Google API proxy, report endpoint |");
  p("| `public/index.html` | Dashboard: stats, filters, table |");
  p("| `public/exam.html` | Exam detail page: data entry, upload, prompts |");
  br();
  h("### Adding New Features"); br();
  p("1. Analyze existing code structure");
  p("2. Follow established patterns");
  p("3. Regenerate documentation: `node docs/project_doc_generator.js`");
  p("4. Update `package.json` if adding new npm packages");
  p("5. Create a backup before making any changes");
  br(); hr(); br();

  // ── Version history ───────────────────────────────────────────────────────
  h("## 📋 VERSION HISTORY"); br();
  p(`**Current Version:** ${pkg.version || VERSION}`); br();
  h("### Recent Changes"); br();
  p(`**${pkg.version || VERSION}** (${now().slice(0, 10)})`);
  p("- Dynamic documentation generator added (`docs/project_doc_generator.js`)");
  p("- Auto-generated Admin and Public PDF reports");
  p("- Split prompt architecture (`public/prompts/digitizePrompt.js`, `public/prompts/doubleCheckPrompt.js`)");
  p("- Shared PDF engine (`reports/reportPdfShared.js`)");
  p("- Railway deployment configuration");
  br(); hr(); br();

  // ── Additional resources ──────────────────────────────────────────────────
  h("## 📚 ADDITIONAL RESOURCES"); br();
  p("- **Schema reference:** `docs/SCHEMA.md`");
  p("- **Exam data & report architecture:** `docs/EXAM_DATA.md`");
  p("- **Prompt editing rules:** `docs/PROMPT_EDITING_RULES.md`");
  p("- **Backups:** `0-Archive/backups/`");
  br();
  h("### Useful Links"); br();
  p("- Node.js Documentation: https://nodejs.org/docs/");
  p("- Google Sheets API v4: https://developers.google.com/sheets/api");
  p("- Google Drive API v3: https://developers.google.com/drive/api");
  p("- Railway Deployment: https://railway.app/");
  br(); hr(); br();
  p(`*Documentation generated on ${now()}*`); br();
  p("*Generator Version: 2.0*"); br();
  p(`*Total documentation size: ${stats.totalLines.toLocaleString()} lines analyzed*`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON export
// ─────────────────────────────────────────────────────────────────────────────
function exportJson(data, outputPath) {
  const { modules, stats, externalPackages, packageMeta, routes } = data;
  const summary = {
    generated:         new Date().toISOString(),
    project_root:      PROJECT_ROOT,
    project_name:      packageMeta?.name || PROJECT_NAME,
    version:           packageMeta?.version || VERSION,
    statistics:        { ...stats, externalPackages: externalPackages.size },
    external_packages: [...externalPackages].sort(),
    routes,
    modules:           Object.keys(modules),
  };
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`✅ JSON summary exported: ${outputPath}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
function run() {
  console.log("\n" + "=".repeat(70));
  console.log("  📚 ENHANCED PROJECT DOCUMENTATION GENERATOR v2.0");
  console.log("  Exam Tracker — Node.js Edition");
  console.log("=".repeat(70) + "\n");

  console.log("🔍 Scanning project files...");
  const scanned  = scanProject();
  const depGraph = buildDepGraph(scanned.modules);
  const data     = { ...scanned, depGraph };

  console.log(`   Found ${scanned.stats.totalFiles} files · ${scanned.stats.totalLines.toLocaleString()} lines`);

  console.log("📝 Generating markdown documentation...");
  const markdown   = generateMarkdown(data);
  const docPath    = path.join(PROJECT_ROOT, "docs", "PROJECT_DOCUMENTATION.md");
  fs.writeFileSync(docPath, markdown, "utf8");
  console.log(`✅ Documentation written: ${docPath}`);

  if (EXPORT_JSON) {
    const jsonPath = path.join(PROJECT_ROOT, "docs", "project_summary.json");
    exportJson(data, jsonPath);
  }

  console.log("\n" + "=".repeat(70));
  console.log("✅ DOCUMENTATION GENERATION COMPLETE");
  console.log("=".repeat(70));
  console.log(`\n📄 Documentation: ${docPath}`);
  console.log(`\n💡 To regenerate:`);
  console.log(`   node docs/project_doc_generator.js`);
  console.log(`   node docs/project_doc_generator.js --json`);
}

run();
