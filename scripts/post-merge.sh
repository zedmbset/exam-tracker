#!/bin/bash
# Post-merge setup for the Exam Tracker backend.
# Runs automatically after a task merges into main.
# Keep this idempotent and non-interactive (stdin is closed).

set -e

# Install / sync node dependencies only when package.json or the lockfile
# actually changed in the merge, to keep post-merge fast.
if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -qE '^(package(-lock)?\.json)$'; then
  echo "[post-merge] package manifest changed — running npm install"
  npm install --no-audit --no-fund --no-progress
else
  echo "[post-merge] no manifest changes — skipping npm install"
fi

echo "[post-merge] done"
