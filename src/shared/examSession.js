(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ExamSessionUtils = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ROTATIONS = ["R1", "R2", "R3"];
  var PERIODS = ["P1", "P2", "P3"];
  var UNKNOWN_PERIOD = "UNK";
  var SEMESTERS = ["S1", "S2"];
  var SPECIAL_TYPES = ["RTRPG", "SYNTH"];
  var BULLET = " \u2022 ";

  function cleanString(value) {
    return String(value == null ? "" : value).trim();
  }

  function upperToken(value) {
    return cleanString(value).replace(/\s+/g, "").toUpperCase();
  }

  function normalizeRotation(value) {
    var token = upperToken(value);
    return ROTATIONS.indexOf(token) >= 0 ? token : null;
  }

  function normalizePeriod(value) {
    var token = upperToken(value);
    if (token === "UNK" || token === "UNKNOWN" || token === "UNKNOWNPERIOD" || token === "PUNK" || token === "PUNKNOWN") return UNKNOWN_PERIOD;
    return PERIODS.indexOf(token) >= 0 ? token : null;
  }

  function normalizeSemester(value) {
    var token = upperToken(value);
    return SEMESTERS.indexOf(token) >= 0 ? token : null;
  }

  function normalizeSpecialType(value) {
    var token = upperToken(value);
    if (!token) return null;
    if (token === "RTRPG" || token === "RATTRAPAGE") return "RTRPG";
    if (token === "SYNTH" || token === "SYTH" || token === "SYNTHESE" || token === "SYNTHESE") return "SYNTH";
    return SPECIAL_TYPES.indexOf(token) >= 0 ? token : null;
  }

  function normalizeLevel(value) {
    return upperToken(value);
  }

  function isLevel6A(value) {
    return normalizeLevel(value) === "6A";
  }

  function buildClinical(rotation, period) {
    var isUnknownPeriod = period === UNKNOWN_PERIOD;
    return {
      phase: "clinical",
      groupType: "rotation",
      groupValue: rotation,
      period: period,
      specialType: null,
      label: "Clinical" + BULLET + rotation + BULLET + (isUnknownPeriod ? "Unknown period" : period),
      code: rotation + "-" + period,
    };
  }

  function buildPreclinical(semester) {
    return {
      phase: "preclinical",
      groupType: "semester",
      groupValue: semester,
      period: null,
      specialType: null,
      label: "Preclinical" + BULLET + semester,
      code: semester,
    };
  }

  function buildSpecial(type) {
    var label = type === "SYNTH" ? "Synthese" : "Rattrapage";
    return {
      phase: "special",
      groupType: "special",
      groupValue: null,
      period: null,
      specialType: type,
      label: label,
      code: type,
    };
  }

  function parseCodeString(raw, level) {
    var token = upperToken(raw);
    if (!token) return null;

    var clinicalMatch = token.match(/^(R[123])[-_/ ]?(P[123]|UNK)$/);
    if (clinicalMatch) {
      return buildClinical(clinicalMatch[1], clinicalMatch[2]);
    }

    if (token.indexOf("CLN-") === 0) {
      clinicalMatch = token.slice(4).match(/^(R[123])[-_/ ]?(P[123]|UNK)$/);
      if (clinicalMatch) return buildClinical(clinicalMatch[1], clinicalMatch[2]);
    }

    var semester = normalizeSemester(token);
    if (semester) return buildPreclinical(semester);

    if (token.indexOf("PRE-") === 0) {
      semester = normalizeSemester(token.slice(4));
      if (semester) return buildPreclinical(semester);
    }

    var sessionParts = cleanString(raw).split(/\u2022/).map(function (part) {
      return cleanString(part);
    }).filter(Boolean);
    if (sessionParts.length === 2) {
      var bulletRotation = normalizeRotation(sessionParts[0]);
      var bulletPeriod = normalizePeriod(sessionParts[1]);
      if (bulletRotation && bulletPeriod) return buildClinical(bulletRotation, bulletPeriod);
    }

    var special = normalizeSpecialType(token);
    if (special) {
      if (special === "SYNTH" && !isLevel6A(level)) return null;
      return buildSpecial(special);
    }

    return null;
  }

  function canonicalizeSession(input, options) {
    if (!input || typeof input !== "object") return null;
    var level = options && options.level;
    var phase = cleanString(input.phase).toLowerCase();
    var groupType = cleanString(input.groupType).toLowerCase();
    var groupValue = cleanString(input.groupValue);
    var period = cleanString(input.period);
    var specialType = cleanString(input.specialType);
    var code = cleanString(input.code);
    var label = cleanString(input.label);

    if (phase === "clinical" || groupType === "rotation" || normalizeRotation(groupValue)) {
      var rotation = normalizeRotation(groupValue);
      var clinicalPeriod = normalizePeriod(period);
      if (!rotation && code) {
        var fromCode = parseCodeString(code, level);
        if (fromCode && fromCode.phase === "clinical") return fromCode;
      }
      if (!rotation || !clinicalPeriod) return null;
      return buildClinical(rotation, clinicalPeriod);
    }

    if (phase === "preclinical" || groupType === "semester" || normalizeSemester(groupValue)) {
      var semester = normalizeSemester(groupValue);
      if (!semester && code) {
        var preFromCode = parseCodeString(code, level);
        if (preFromCode && preFromCode.phase === "preclinical") return preFromCode;
      }
      if (!semester) return null;
      return buildPreclinical(semester);
    }

    var special = normalizeSpecialType(specialType || groupValue || code || label);
    if (phase === "special" || groupType === "special" || special) {
      if (!special) return null;
      if (special === "SYNTH" && !isLevel6A(level)) return null;
      return buildSpecial(special);
    }

    if (code) return parseCodeString(code, level);
    if (label) return parseCodeString(label, level);
    return null;
  }

  function inferLegacySession(rotationValue, periodValue, level) {
    var rotation = normalizeRotation(rotationValue);
    var period = normalizePeriod(periodValue);
    var semester = normalizeSemester(rotationValue) || normalizeSemester(periodValue);
    var special = normalizeSpecialType(periodValue) || normalizeSpecialType(rotationValue);

    if (rotation && period) return buildClinical(rotation, period);
    if (rotation && !cleanString(periodValue)) return buildClinical(rotation, UNKNOWN_PERIOD);
    if (semester) return buildPreclinical(semester);
    if (special) {
      if (special === "SYNTH" && !isLevel6A(level)) return null;
      return buildSpecial(special);
    }
    return null;
  }

  function buildLegacyDescriptor(rotationValue, periodValue) {
    var rawRotation = cleanString(rotationValue);
    var rawPeriod = cleanString(periodValue);
    var pieces = [rawRotation, rawPeriod].filter(Boolean);
    if (!pieces.length) return null;
    var label = pieces.join(BULLET);
    return {
      phase: "legacy",
      groupType: "legacy",
      groupValue: rawRotation || rawPeriod || null,
      period: rawPeriod || null,
      specialType: null,
      label: label,
      code: "LEGACY",
      isLegacy: true,
      isValid: false,
      shortLabel: label,
      ref: (rawPeriod + rawRotation).replace(/\s+/g, "") || "LEGACY",
      periodLabelForTags: rawPeriod || rawRotation || "",
    };
  }

  function enrichSession(session) {
    if (!session) return null;
    var out = {
      phase: session.phase,
      groupType: session.groupType,
      groupValue: session.groupValue == null ? null : session.groupValue,
      period: session.period == null ? null : session.period,
      specialType: session.specialType == null ? null : session.specialType,
      label: session.label,
      code: session.code,
    };

    out.isLegacy = !!session.isLegacy;
    out.isValid = session.isValid !== false;

    if (out.phase === "clinical") {
      out.shortLabel = [out.groupValue, out.period === UNKNOWN_PERIOD ? "Unknown period" : out.period].filter(Boolean).join(BULLET);
      out.ref = "" + (out.period === UNKNOWN_PERIOD ? UNKNOWN_PERIOD : (out.period || "")) + (out.groupValue || "");
      out.periodLabelForTags = out.period === UNKNOWN_PERIOD ? "Unknown period" : (out.period || "");
    } else if (out.phase === "preclinical") {
      out.shortLabel = out.groupValue || "";
      out.ref = out.groupValue || "";
      out.periodLabelForTags = out.groupValue || "";
    } else if (out.phase === "special") {
      out.shortLabel = out.specialType === "SYNTH" ? "Synthese" : "Rattrapage";
      out.ref = out.specialType || "";
      out.periodLabelForTags = out.shortLabel;
    } else {
      out.shortLabel = cleanString(session.shortLabel || session.label || "");
      out.ref = cleanString(session.ref || out.code || "");
      out.periodLabelForTags = cleanString(session.periodLabelForTags || out.shortLabel || "");
    }

    return out;
  }

  function parseExamSession(raw, options) {
    options = options || {};
    var canonical = null;
    var parsed = raw;

    if (typeof raw === "string") {
      var trimmed = raw.trim();
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch (err) {
          parsed = trimmed;
        }
      }
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      canonical = canonicalizeSession(parsed, options);
    } else if (typeof parsed === "string") {
      canonical = parseCodeString(parsed, options.level);
    }

    if (!canonical) {
      canonical = inferLegacySession(options.legacyRotation, options.legacyPeriod, options.level);
    }

    if (canonical) return enrichSession(canonical);

    var legacy = buildLegacyDescriptor(options.legacyRotation, options.legacyPeriod);
    return legacy ? legacy : null;
  }

  function buildExamSession(input, options) {
    options = options || {};
    var family = cleanString(input && input.family).toLowerCase();
    var level = options.level || (input && input.level) || "";

    if (family === "clinical") {
      var rotation = normalizeRotation(input && input.rotation);
      var period = normalizePeriod(input && input.period);
      if (!rotation || !period) {
        throw new Error("Clinical sessions require a valid rotation and period.");
      }
      return enrichSession(buildClinical(rotation, period));
    }

    if (family === "preclinical") {
      var semester = normalizeSemester(input && input.semester);
      if (!semester) {
        throw new Error("Preclinical sessions require a valid semester.");
      }
      return enrichSession(buildPreclinical(semester));
    }

    if (family === "rattrapage" || family === "synthese" || family === "special") {
      var special = normalizeSpecialType(input && (input.specialType || input.family));
      if (!special) {
        throw new Error("Special sessions require a valid special type.");
      }
      if (special === "SYNTH" && !isLevel6A(level)) {
        throw new Error("Synthese is allowed only for level 6A.");
      }
      return enrichSession(buildSpecial(special));
    }

    throw new Error("Session family is required.");
  }

  function serializeExamSession(session) {
    var enriched = null;
    if (session && typeof session === "object" && !Array.isArray(session) && (session.phase || session.code)) {
      enriched = enrichSession(session);
    } else {
      enriched = parseExamSession(session, {});
    }
    if (!enriched || !enriched.isValid || !enriched.code) {
      throw new Error("ExamSession is missing or invalid.");
    }
    return enriched.code;
  }

  function formatExamSessionShort(session) {
    var parsed = parseExamSession(session, {});
    return parsed ? parsed.shortLabel || parsed.label || "" : "";
  }

  function formatExamSessionLong(session) {
    var parsed = parseExamSession(session, {});
    return parsed ? parsed.label || parsed.shortLabel || "" : "";
  }

  return {
    ROTATIONS: ROTATIONS.slice(),
    PERIODS: PERIODS.slice(),
    SEMESTERS: SEMESTERS.slice(),
    SPECIAL_TYPES: SPECIAL_TYPES.slice(),
    normalizeRotation: normalizeRotation,
    normalizePeriod: normalizePeriod,
    normalizeSemester: normalizeSemester,
    normalizeSpecialType: normalizeSpecialType,
    normalizeLevel: normalizeLevel,
    isLevel6A: isLevel6A,
    parseExamSession: parseExamSession,
    buildExamSession: buildExamSession,
    serializeExamSession: serializeExamSession,
    formatExamSessionShort: formatExamSessionShort,
    formatExamSessionLong: formatExamSessionLong,
  };
}));
