(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ExamStatusUtils = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STATUS_COMPLETED = "Completed";
  var STATUS_PENDING = "Pending";
  var STATUS_NEW_EXAM = "New Exam";
  var STATUS_MISSING = "Missing";
  var STATUS_OPTIONS = [STATUS_COMPLETED, STATUS_PENDING, STATUS_NEW_EXAM, STATUS_MISSING];
  var DAY_MS = 86400000;

  function cleanString(value) {
    return String(value == null ? "" : value).trim();
  }

  function isPresent(value) {
    return cleanString(value) !== "";
  }

  function normalizeStatusValue(value) {
    var raw = cleanString(value);
    if (!raw) return "";
    var lowered = raw.toLowerCase().replace(/\s+/g, " ");
    if (lowered === "completed") return STATUS_COMPLETED;
    if (lowered === "missing") return STATUS_MISSING;
    if (lowered === "new exam") return STATUS_NEW_EXAM;
    if (lowered === "pending") return STATUS_PENDING;
    return raw;
  }

  function parseExamDateValue(value) {
    var raw = cleanString(value);
    var match;
    var year;
    var month;
    var day;
    var direct;

    if (!raw) return null;

    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      return buildValidDate(year, month, day);
    }

    match = raw.replace(/\./g, "/").replace(/-/g, "/").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      var first = Number(match[1]);
      var second = Number(match[2]);
      year = Number(match[3]);
      if (second > 12) {
        month = first;
        day = second;
      } else {
        day = first;
        month = second;
      }
      return buildValidDate(year, month, day);
    }

    direct = new Date(raw);
    if (Number.isNaN(direct.getTime())) return null;
    return new Date(direct.getFullYear(), direct.getMonth(), direct.getDate());
  }

  function buildValidDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function getTodayDateOnly(now) {
    var current = now instanceof Date ? now : new Date();
    return new Date(current.getFullYear(), current.getMonth(), current.getDate());
  }

  function defaultGetCell(row, name) {
    if (!row) return "";
    if (typeof row.cell === "function") return row.cell(name);
    if (row.cells && row.cols && Object.prototype.hasOwnProperty.call(row.cols, name)) {
      return row.cells[row.cols[name]] || "";
    }
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    return "";
  }

  function readCell(row, name, getCell) {
    return typeof getCell === "function" ? getCell(row, name) : defaultGetCell(row, name);
  }

  function deriveAutomaticStatus(row, getCell, now) {
    if (isPresent(readCell(row, "Quiz_Tbl", getCell))) return STATUS_COMPLETED;

    var examDate = parseExamDateValue(readCell(row, "ExamDate", getCell) || readCell(row, "Exam Date", getCell));
    if (!examDate) return "";

    var today = getTodayDateOnly(now);
    if (examDate > today) return "";

    if (isPresent(readCell(row, "OrigPDF", getCell))) return STATUS_PENDING;

    var ageDays = Math.floor((today - examDate) / DAY_MS);
    return ageDays <= 15 ? STATUS_NEW_EXAM : STATUS_MISSING;
  }

  function isManualCompletedOverride(row, getCell) {
    return normalizeStatusValue(readCell(row, "Status", getCell)) === STATUS_COMPLETED
      && !isPresent(readCell(row, "Quiz_Tbl", getCell));
  }

  function deriveEffectiveStatus(row, getCell, now) {
    if (isManualCompletedOverride(row, getCell)) return STATUS_COMPLETED;
    return deriveAutomaticStatus(row, getCell, now);
  }

  function syncEffectiveStatus(row, getCell, setCell, now) {
    var nextStatus = deriveEffectiveStatus(row, getCell, now);
    var currentStatus = normalizeStatusValue(readCell(row, "Status", getCell));
    if (currentStatus === nextStatus) return false;
    setCell(row, "Status", nextStatus);
    return true;
  }

  return {
    STATUS_COMPLETED: STATUS_COMPLETED,
    STATUS_PENDING: STATUS_PENDING,
    STATUS_NEW_EXAM: STATUS_NEW_EXAM,
    STATUS_MISSING: STATUS_MISSING,
    STATUS_OPTIONS: STATUS_OPTIONS,
    isPresent: isPresent,
    normalizeStatusValue: normalizeStatusValue,
    parseExamDateValue: parseExamDateValue,
    deriveAutomaticStatus: deriveAutomaticStatus,
    deriveEffectiveStatus: deriveEffectiveStatus,
    isManualCompletedOverride: isManualCompletedOverride,
    syncEffectiveStatus: syncEffectiveStatus,
  };
}));
