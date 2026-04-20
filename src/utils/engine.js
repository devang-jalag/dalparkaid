const BASE_SCORE = 55;
const RECENT_REPORT_WINDOW_MINS = 90;
const SHORT_GUARD_MINS = 15;
const FRESHNESS_DECAY_MINS = 45;
const MAX_CROWD_ALPHA = 0.9;
const MAX_NEGATIVE_AGE_MINS = 5;
const CROWD_CONFIDENCE_CURVE_K = 2.2;
const CROWD_DISAGREEMENT_SCALE = 26;
const SINGLE_REPORT_SHORT_GUARD_BAND = 38;
const MAX_RECENT_CROWD_ALPHA_BOOST = 0.2;
const TIMELINE_RECENT_REPORT_INERTIA_WINDOW_MINS = 45;
const MAX_TIMELINE_CROWD_CARRY = 0.7;
const MAX_TIMELINE_CROWD_CARRY_HOURS = 5;
const PATTERN_LOOKBACK_DAYS = 42;
const PATTERN_SLOT_HOUR_TOLERANCE = 1;
const MIN_PATTERN_REPORTS = 3;
const MAX_PATTERN_ALPHA_BOOST = 0.18;
const MAX_PATTERN_ONLY_ALPHA = 0.22;
const MIN_COMMUNITY_VOTE_WEIGHT = 0.35;
const MAX_COMMUNITY_VOTE_WEIGHT = 1.9;
const TEACHING_DAY = 'TEACHING_DAY';
const LOT_TYPES = Object.freeze({
  COMMUTER_LOT: 'COMMUTER_LOT',
  RESIDENCE_LOT: 'RESIDENCE_LOT',
  PARKADE_LOT: 'PARKADE_LOT',
  EVENT_LOT: 'EVENT_LOT',
});

const dayAdjustment = [10, -3, -4, -5, -4, -1, 7];

const hourAdjustment = [
  22, 22, 22, 20, 18, 14,
  6, -2, -8, -12, -16, -18,
  -18, -18, -15, -12, -8, -2,
  4, 8, 12, 15, 17, 18,
];

const ratingScoreMap = Object.freeze({
  1: 10,
  2: 30,
  3: 50,
  4: 72,
  5: 88,
});

const rainyWeather = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const snowyWeather = new Set([71, 73, 75, 77, 85, 86]);
const stormWeather = new Set([95, 96, 99]);
const foggyWeather = new Set([45, 48]);

const academicDayAdjustment = Object.freeze({
  TEACHING_DAY: 0,
  FRIDAY_SCHEDULE_OVERRIDE: -2,
  EXAM_PERIOD: 2,
  READING_WEEK: 16,
  WINTER_BREAK: 20,
  UNIVERSITY_CLOSED: 32,
});

const closureAdjustment = Object.freeze({
  OPEN: 0,
  DELAYED: 14,
  CLOSED: 32,
});

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const clamp01 = (value) => clamp(value, 0, 1);
const lerp = (start, end, factor) => start + (end - start) * factor;
const ISO_WITH_TIMEZONE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+\-]\d{2}:\d{2})$/;

const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const toNonNegativeNumber = (value) => {
  const normalized = toFiniteNumber(value);
  return normalized == null ? 0 : Math.max(0, normalized);
};

const toMillis = (value) => {
  if (value == null) {
    return null;
  }

  const directNumber = toFiniteNumber(value);
  if (directNumber != null && typeof value !== 'string') {
    return directNumber;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const numericTimestamp = Number(trimmed);
      return trimmed.length === 10 ? numericTimestamp * 1000 : numericTimestamp;
    }

    if (!ISO_WITH_TIMEZONE_RE.test(trimmed)) {
      return null;
    }

    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const hasProof = (report) =>
  Boolean(
    report?.imgUri ||
      report?.photoUrl ||
      report?.photoPath ||
      report?.imageUrl ||
      report?.proofUrl
  );

const normalizeRating = (rating) => {
  const normalized = toFiniteNumber(rating);
  if (normalized == null) {
    return null;
  }

  const roundedRating = Math.round(normalized);
  return ratingScoreMap[roundedRating] == null ? null : roundedRating;
};

const normalizeWeatherCode = (weatherCode) => {
  const normalized = toFiniteNumber(weatherCode);
  return normalized == null ? null : Math.round(normalized);
};

const normalizeAgeMins = (nowMs, createdAtMs) => {
  const rawAgeMins = (nowMs - createdAtMs) / 60000;
  if (!Number.isFinite(rawAgeMins) || rawAgeMins < -MAX_NEGATIVE_AGE_MINS) {
    return null;
  }

  return Math.max(0, rawAgeMins);
};

const getReportUserKey = (report, createdAtMs) => {
  const userKey = report?.userId || report?.userEmail;
  if (userKey) {
    return String(userKey).trim().toLowerCase();
  }

  return `anon:${report?.id || createdAtMs || 'unknown'}`;
};

const getLotSizeAdjustment = (capacity) => {
  if (capacity >= 120) return 9;
  if (capacity >= 80) return 5;
  if (capacity >= 40) return 0;
  if (capacity >= 20) return -5;
  return -9;
};

const getWeatherAdjustment = (weatherCode) => {
  const normalizedCode = normalizeWeatherCode(weatherCode);
  if (normalizedCode == null) return 0;
  if (stormWeather.has(normalizedCode)) return -12;
  if (snowyWeather.has(normalizedCode)) return -10;
  if (rainyWeather.has(normalizedCode)) return -8;
  if (foggyWeather.has(normalizedCode)) return -4;
  return 0;
};

const getAcademicAdjustment = (academicDayType) =>
  academicDayAdjustment[academicDayType] ?? academicDayAdjustment.TEACHING_DAY;

const getClosureAdjustment = (state) => closureAdjustment[state] ?? closureAdjustment.OPEN;

const getCampusLoadAdjustment = (campusLoadIndex) => {
  if (typeof campusLoadIndex !== 'number' || !Number.isFinite(campusLoadIndex)) {
    return 0;
  }

  return Math.round(8 - clamp(campusLoadIndex, 0, 1) * 20);
};

const inferLotType = (lot) => {
  const directType = typeof lot?.lotType === 'string' ? lot.lotType.trim().toUpperCase() : null;
  if (directType && Object.values(LOT_TYPES).includes(directType)) {
    return directType;
  }

  const lotName = `${lot?.name || ''}`.toLowerCase();
  if (
    [
      'glengarry',
      'risley hall lot',
      'risley hall parkade',
      'shirreff hall',
      'stairs',
    ].includes(lotName)
  ) {
    return LOT_TYPES.RESIDENCE_LOT;
  }

  if (lotName === 'dalplex') {
    return LOT_TYPES.EVENT_LOT;
  }

  if (lotName.includes('parkade')) {
    return LOT_TYPES.PARKADE_LOT;
  }

  return LOT_TYPES.COMMUTER_LOT;
};

const getLotTypeTimeAdjustment = (lotType, hour) => {
  switch (lotType) {
    case LOT_TYPES.RESIDENCE_LOT:
      if (hour <= 6) return -6;
      if (hour <= 16) return 6;
      return -8;
    case LOT_TYPES.PARKADE_LOT:
      return 2;
    case LOT_TYPES.EVENT_LOT:
      if (hour >= 7 && hour <= 14) return 3;
      if (hour >= 17 && hour <= 22) return -8;
      return 0;
    default:
      return 0;
  }
};

const getLotTypeDayAdjustment = (lotType, weekday) => {
  const isWeekend = weekday === 0 || weekday === 6;

  switch (lotType) {
    case LOT_TYPES.RESIDENCE_LOT:
      return isWeekend ? 4 : 0;
    case LOT_TYPES.PARKADE_LOT:
      return isWeekend ? 0 : 1;
    case LOT_TYPES.EVENT_LOT:
      return isWeekend ? -2 : 0;
    default:
      return 0;
  }
};

export const scoreToStatus = (n) => {
  if (n >= 80) return 'EMPTY';
  if (n >= 58) return 'NORMAL';
  if (n >= 36) return 'CROWDED';
  if (n >= 16) return 'ALMOST_FULL';
  if (n >= 0) return 'FULL';
  return 'UNKNOWN';
};

const EVENING_START_HOUR = 17;
const DAYTIME_START_HOUR = 6;

export const isEveningTime = (date = new Date()) => {
  const hour = date.getHours();
  return hour >= EVENING_START_HOUR || hour < DAYTIME_START_HOUR;
};

export const getCapacityForCurrentPeriod = (lot, date = new Date()) => {
  if (isEveningTime(date)) {
    return toNonNegativeNumber(lot?.eveningGeneralSpaces) + toNonNegativeNumber(lot?.eveningShortTermSpaces);
  }

  return (
    toNonNegativeNumber(lot?.generalSpaces) +
    toNonNegativeNumber(lot?.shortTermSpaces)
  );
};

const getLotSizeReferenceCapacity = (lot, usableCapacity) => {
  const weightedDaytimeCapacity =
    toNonNegativeNumber(lot?.generalSpaces) +
    toNonNegativeNumber(lot?.shortTermSpaces) +
    toNonNegativeNumber(lot?.reservedSpaces) * 0.35;
  const eveningCapacity =
    toNonNegativeNumber(lot?.eveningGeneralSpaces) +
    toNonNegativeNumber(lot?.eveningShortTermSpaces);

  return Math.max(usableCapacity, weightedDaytimeCapacity, eveningCapacity);
};

const getPhysicalLotCapacity = (lot) => {
  const daytimeCapacity =
    toNonNegativeNumber(lot?.generalSpaces) +
    toNonNegativeNumber(lot?.reservedSpaces) +
    toNonNegativeNumber(lot?.shortTermSpaces);
  const eveningCapacity =
    toNonNegativeNumber(lot?.eveningGeneralSpaces) +
    toNonNegativeNumber(lot?.eveningShortTermSpaces);

  return Math.max(daytimeCapacity, eveningCapacity);
};

export const predictEngineScore = ({
  lot,
  weatherCode,
  atDate,
  campusLoadIndex = null,
  academicDayType = 'TEACHING_DAY',
  closureState = 'OPEN',
}) => {
  const now = atDate instanceof Date ? atDate : new Date(atDate || Date.now());
  const hour = now.getHours();
  const weekday = now.getDay();
  const usableCapacity = getCapacityForCurrentPeriod(lot, now);
  const lotSizeReferenceCapacity = getLotSizeReferenceCapacity(lot, usableCapacity);
  const physicalCapacity = getPhysicalLotCapacity(lot);
  const lotType = inferLotType(lot);

  const factors = {
    base: BASE_SCORE,
    hour: hourAdjustment[hour] ?? 0,
    day: dayAdjustment[weekday] ?? 0,
    weather: getWeatherAdjustment(weatherCode),
    lotSize: getLotSizeAdjustment(lotSizeReferenceCapacity),
    academicDay: getAcademicAdjustment(academicDayType),
    closure: getClosureAdjustment(closureState),
    campusLoad: getCampusLoadAdjustment(campusLoadIndex),
    lotTypeTime: getLotTypeTimeAdjustment(lotType, hour),
    lotTypeDay: getLotTypeDayAdjustment(lotType, weekday),
  };

  const score = clamp(
    Math.round(
      factors.base +
        factors.hour +
        factors.day +
        factors.weather +
        factors.lotSize +
        factors.academicDay +
        factors.closure +
        factors.campusLoad +
        factors.lotTypeTime +
        factors.lotTypeDay
    )
  );

  return {
    score,
    status: scoreToStatus(score),
    lotType,
    usableCapacity,
    lotSizeReferenceCapacity,
    physicalCapacity,
    factors,
  };
};

const getFreshnessWeight = (ageMins) => Math.exp(-ageMins / FRESHNESS_DECAY_MINS);
const getProofWeight = (report) => (hasProof(report) ? 1.15 : 1);
const getTrustWeight = (report) => {
  if (typeof report?.userTrust === 'number' && Number.isFinite(report.userTrust)) {
    return clamp(report.userTrust, 0.7, 1.3);
  }
  return 1;
};

const getTimelineReportTimestampMs = (report) =>
  toMillis(report?.createdAt) ?? toMillis(report?.clientCreatedAt);

export const getCommunityVoteWeight = (report) => {
  const normalized = toFiniteNumber(report?.voteWeightMultiplier);
  if (normalized == null) {
    return 1;
  }

  return clamp(normalized, MIN_COMMUNITY_VOTE_WEIGHT, MAX_COMMUNITY_VOTE_WEIGHT);
};

export const aggregateCrowdReports = (reports = [], nowInput = new Date()) => {
  const nowMs = toMillis(nowInput) ?? Date.now();
  const safeReports = Array.isArray(reports) ? reports : [];
  const bestReportByUser = new Map();

  safeReports
    .map((report) => {
      const createdAtMs = toMillis(report?.createdAt);
      if (!createdAtMs) {
        return null;
      }

      const ageMins = normalizeAgeMins(nowMs, createdAtMs);
      if (ageMins == null || ageMins > RECENT_REPORT_WINDOW_MINS) {
        return null;
      }

      const normalizedRating = normalizeRating(report?.rating);
      if (normalizedRating == null) {
        return null;
      }

      const mappedScore = ratingScoreMap[normalizedRating];
      const weight =
        getFreshnessWeight(ageMins) *
        getProofWeight(report) *
        getTrustWeight(report) *
        getCommunityVoteWeight(report);
      if (!Number.isFinite(weight) || weight <= 0) {
        return null;
      }

      return {
        ...report,
        createdAtMs,
        ageMins,
        normalizedRating,
        mappedScore,
        weight,
      };
    })
    .filter(Boolean)
    .forEach((report) => {
      const userKey = getReportUserKey(report, report.createdAtMs);
      const previousBestReport = bestReportByUser.get(userKey);

      if (
        !previousBestReport ||
        report.weight > previousBestReport.weight ||
        (report.weight === previousBestReport.weight &&
          report.createdAtMs > previousBestReport.createdAtMs)
      ) {
        bestReportByUser.set(userKey, report);
      }
    });

  const recentReports = Array.from(bestReportByUser.values()).sort(
    (left, right) => right.createdAtMs - left.createdAtMs
  );

  if (!recentReports.length) {
    return {
      crowdScore: null,
      crowdConfidence: 0,
      latestReportAgeMins: null,
      latestReportAt: null,
      reportCount: 0,
      rawReportCount: 0,
      uniqueUserCount: 0,
      disagreement: 0,
      recentReports: [],
    };
  }

  const totalWeight = recentReports.reduce((sum, report) => sum + report.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return {
      crowdScore: null,
      crowdConfidence: 0,
      latestReportAgeMins: recentReports[0].ageMins,
      latestReportAt: recentReports[0].createdAtMs,
      reportCount: 0,
      rawReportCount: safeReports.length,
      uniqueUserCount: 0,
      disagreement: 0,
      recentReports: [],
    };
  }

  const weightedScore = recentReports.reduce(
    (sum, report) => sum + report.mappedScore * report.weight,
    0
  );
  const crowdScore = Math.round(weightedScore / totalWeight);
  const weightedDeviation =
    recentReports.reduce(
      (sum, report) => sum + Math.abs(report.mappedScore - crowdScore) * report.weight,
      0
    ) / totalWeight;
  const disagreement = clamp01(weightedDeviation / CROWD_DISAGREEMENT_SCALE);
  const confidenceBase =
    MAX_CROWD_ALPHA * (1 - Math.exp(-totalWeight / CROWD_CONFIDENCE_CURVE_K));
  const uniqueUserCount = recentReports.length;
  const uniqueUserFactor = 0.78 + 0.22 * clamp01((uniqueUserCount - 1) / 3);
  const crowdConfidence = clamp(
    confidenceBase * (1 - 0.55 * disagreement) * uniqueUserFactor,
    0,
    MAX_CROWD_ALPHA
  );

  return {
    crowdScore,
    crowdConfidence,
    latestReportAgeMins: recentReports[0].ageMins,
    latestReportAt: recentReports[0].createdAtMs,
    reportCount: uniqueUserCount,
    rawReportCount: safeReports.length,
    uniqueUserCount,
    disagreement,
    recentReports,
  };
};

const getHourDistance = (leftDate, rightDate) => {
  const leftHour = leftDate.getHours();
  const rightHour = rightDate.getHours();
  const rawDistance = Math.abs(leftHour - rightHour);
  return Math.min(rawDistance, 24 - rawDistance);
};

export const aggregateHistoricalPattern = (
  reports = [],
  nowInput = new Date(),
  currentAcademicDayType = TEACHING_DAY
) => {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
  const nowMs = toMillis(now) ?? Date.now();
  const dailyUserReports = new Map();
  const safeReports = Array.isArray(reports) ? reports : [];

  const candidateReports = safeReports
    .map((report) => {
      const createdAtMs = toMillis(report?.createdAt);
      if (!createdAtMs) {
        return null;
      }

      const normalizedRating = normalizeRating(report?.rating);
      if (normalizedRating == null) {
        return null;
      }

      const ageMins = normalizeAgeMins(nowMs, createdAtMs);
      if (ageMins == null) {
        return null;
      }

      const ageDays = ageMins / (24 * 60);
      if (ageDays > PATTERN_LOOKBACK_DAYS) {
        return null;
      }

      const reportDate = new Date(createdAtMs);
      if (reportDate.getDay() !== now.getDay()) {
        return null;
      }

      const reportAcademicDayType =
        typeof report?.derivedAcademicDayType === 'string'
          ? report.derivedAcademicDayType
          : TEACHING_DAY;
      if (reportAcademicDayType !== currentAcademicDayType) {
        return null;
      }

      const hourDistance = getHourDistance(reportDate, now);
      if (hourDistance > PATTERN_SLOT_HOUR_TOLERANCE) {
        return null;
      }

      const recencyWeight = Math.max(0.2, 1 - ageDays / PATTERN_LOOKBACK_DAYS);
      return {
        ...report,
        createdAtMs,
        mappedScore: ratingScoreMap[normalizedRating],
        ageDays,
        recencyWeight: recencyWeight * lerp(1, getCommunityVoteWeight(report), 0.5),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .filter((report) => {
      const reportDate = new Date(report.createdAtMs);
      const dayKey = `${reportDate.getFullYear()}-${reportDate.getMonth() + 1}-${reportDate.getDate()}`;
      const userKey = `${report.userId || report.userEmail || 'anonymous'}:${dayKey}`;

      if (dailyUserReports.has(userKey)) {
        return false;
      }

      dailyUserReports.set(userKey, true);
      return true;
    });

  if (candidateReports.length < MIN_PATTERN_REPORTS) {
    return {
      patternScore: null,
      patternConfidence: 0,
      patternSampleCount: candidateReports.length,
    };
  }

  const totalWeight = candidateReports.reduce((sum, report) => sum + report.recencyWeight, 0);
  const weightedAverage =
    totalWeight > 0
      ? candidateReports.reduce((sum, report) => sum + report.mappedScore * report.recencyWeight, 0) / totalWeight
      : null;

  if (weightedAverage == null) {
    return {
      patternScore: null,
      patternConfidence: 0,
      patternSampleCount: candidateReports.length,
    };
  }

  const weightedDeviation =
    totalWeight > 0
      ? candidateReports.reduce(
          (sum, report) => sum + Math.abs(report.mappedScore - weightedAverage) * report.recencyWeight,
          0
        ) / totalWeight
      : 100;

  const consistency = clamp01(1 - weightedDeviation / 24);
  const sampleStrength = clamp01((candidateReports.length - 2) / 6);
  const patternConfidence = Number((consistency * sampleStrength).toFixed(4));

  return {
    patternScore: Math.round(weightedAverage),
    patternConfidence,
    patternSampleCount: candidateReports.length,
  };
};

const getShortGuardAlphaFloor = (crowd) => {
  const confidenceFactor =
    typeof crowd?.crowdConfidence === 'number' && Number.isFinite(crowd.crowdConfidence)
      ? clamp01(crowd.crowdConfidence / MAX_CROWD_ALPHA)
      : 0;
  const uniqueUserFactor = clamp01(((crowd?.uniqueUserCount || 0) - 1) / 3);
  const agreementFactor = 1 - clamp01(crowd?.disagreement || 0);
  const latestReportHasProof = Boolean(crowd?.recentReports?.[0] && hasProof(crowd.recentReports[0]));

  let alphaFloor = clamp(
    0.28 + uniqueUserFactor * 0.24 + agreementFactor * 0.08 + confidenceFactor * 0.08,
    0.32,
    0.74
  );

  if ((crowd?.uniqueUserCount || 0) === 1) {
    alphaFloor = Math.min(alphaFloor, latestReportHasProof ? 0.72 : 0.6);
  }

  return alphaFloor;
};

const getRecentCrowdAlphaBoost = (crowd) => {
  if (!crowd || crowd.crowdScore == null || crowd.latestReportAgeMins == null) {
    return 0;
  }

  const recencyFactor = clamp01(1 - crowd.latestReportAgeMins / RECENT_REPORT_WINDOW_MINS);
  const freshnessFactor = clamp01(1 - crowd.latestReportAgeMins / 30);
  const uniqueUserFactor = clamp01((crowd.uniqueUserCount || 0) / 3);
  const agreementFactor = 1 - clamp01(crowd.disagreement || 0);
  const latestReportHasProof = Boolean(crowd?.recentReports?.[0] && hasProof(crowd.recentReports[0]));

  let alphaBoost =
    0.05 +
    recencyFactor * 0.07 +
    freshnessFactor * 0.04 +
    uniqueUserFactor * 0.03 +
    agreementFactor * 0.01;

  if (latestReportHasProof) {
    alphaBoost += 0.02;
  }

  return clamp(alphaBoost, 0, MAX_RECENT_CROWD_ALPHA_BOOST);
};

const getShortGuardBand = (crowd) => {
  if ((crowd?.uniqueUserCount || 0) <= 1) {
    const latestReportHasProof = Boolean(crowd?.recentReports?.[0] && hasProof(crowd.recentReports[0]));
    return latestReportHasProof ? 32 : SINGLE_REPORT_SHORT_GUARD_BAND;
  }

  const confidenceFactor =
    typeof crowd?.crowdConfidence === 'number' && Number.isFinite(crowd.crowdConfidence)
      ? clamp01(crowd.crowdConfidence / MAX_CROWD_ALPHA)
      : 0;
  const agreementFactor = 1 - clamp01(crowd?.disagreement || 0);
  const uniqueUserTightening = clamp((crowd?.uniqueUserCount || 0) - 2, 0, 4);

  return Math.round(
    clamp(28 - confidenceFactor * 8 - agreementFactor * 5 - uniqueUserTightening * 2, 12, 28)
  );
};

const combineScores = ({ engineScore, crowd, pattern }) => {
  if (!crowd || crowd.crowdScore == null) {
    if (!pattern || pattern.patternScore == null || pattern.patternConfidence <= 0) {
      return {
        finalScore: engineScore,
        alpha: 0,
      };
    }

    const historicalAlpha = Math.min(
      MAX_PATTERN_ONLY_ALPHA,
      pattern.patternConfidence * MAX_PATTERN_ONLY_ALPHA
    );
    return {
      finalScore: clamp(
        Math.round((1 - historicalAlpha) * engineScore + historicalAlpha * pattern.patternScore)
      ),
      alpha: historicalAlpha,
    };
  }

  const patternAlignment =
    pattern && pattern.patternScore != null
      ? clamp01(1 - Math.abs(crowd.crowdScore - pattern.patternScore) / 28)
      : 0;
  const patternBoost =
    pattern && pattern.patternConfidence > 0
      ? pattern.patternConfidence * MAX_PATTERN_ALPHA_BOOST * patternAlignment
      : 0;
  const recentCrowdBoost = getRecentCrowdAlphaBoost(crowd);

  let alpha = crowd.crowdConfidence + patternBoost + recentCrowdBoost;
  alpha = Math.min(alpha, MAX_CROWD_ALPHA);
  if (
    crowd.latestReportAgeMins != null &&
    crowd.latestReportAgeMins <= SHORT_GUARD_MINS
  ) {
    alpha = Math.max(alpha, getShortGuardAlphaFloor(crowd));
  }

  let finalScore = Math.round((1 - alpha) * engineScore + alpha * crowd.crowdScore);
  if (
    crowd.latestReportAgeMins != null &&
    crowd.latestReportAgeMins <= SHORT_GUARD_MINS
  ) {
    const guardBand = getShortGuardBand(crowd);
    finalScore = clamp(finalScore, crowd.crowdScore - guardBand, crowd.crowdScore + guardBand);
  } else {
    finalScore = clamp(finalScore);
  }

  return {
    finalScore,
    alpha,
  };
};

export const summarizeCrowdIntelligence = (reports = [], nowInput = new Date()) => {
  const crowd = aggregateCrowdReports(reports, nowInput);
  const pattern = aggregateHistoricalPattern(reports, nowInput, TEACHING_DAY);
  return {
    crowd,
    pattern,
  };
};

const getTimelineRecentCrowdCarryStrength = (reports = [], nowInput = new Date()) => {
  const nowMs = toMillis(nowInput) ?? Date.now();
  const recentReports = (Array.isArray(reports) ? reports : [])
    .map((report) => {
      const createdAtMs = getTimelineReportTimestampMs(report);
      if (!createdAtMs) {
        return null;
      }

      const ageMins = (nowMs - createdAtMs) / 60000;
      if (!Number.isFinite(ageMins) || ageMins < -MAX_NEGATIVE_AGE_MINS || ageMins > TIMELINE_RECENT_REPORT_INERTIA_WINDOW_MINS) {
        return null;
      }

      return {
        ...report,
        createdAtMs,
        ageMins,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.ageMins - right.ageMins);

  if (!recentReports.length) {
    return 0;
  }

  const freshestAgeMins = recentReports[0].ageMins;
  const freshnessFactor = clamp01(1 - freshestAgeMins / TIMELINE_RECENT_REPORT_INERTIA_WINDOW_MINS);
  const densityFactor = clamp01(recentReports.length / 3);
  const proofBonus = recentReports.some((report) => hasProof(report)) ? 0.08 : 0;

  return clamp(
    0.36 + freshnessFactor * 0.18 + densityFactor * 0.12 + proofBonus,
    0,
    MAX_TIMELINE_CROWD_CARRY
  );
};

const applyTimelineFutureCarry = (scores = [], currentHour, carryStrength) => {
  if (!Array.isArray(scores) || scores.length === 0 || carryStrength <= 0) {
    return Array.isArray(scores) ? scores : [];
  }

  const nextScores = [...scores];
  for (let hour = currentHour + 1; hour < nextScores.length; hour += 1) {
    const hoursAhead = hour - currentHour;
    const horizonFactor = clamp01(1 - (hoursAhead - 1) / MAX_TIMELINE_CROWD_CARRY_HOURS);
    const carry = clamp(carryStrength * horizonFactor, 0, MAX_TIMELINE_CROWD_CARRY);
    if (carry <= 0) {
      continue;
    }

    nextScores[hour] = Math.round(nextScores[hour] * (1 - carry) + nextScores[hour - 1] * carry);
  }

  return nextScores;
};

export const smoothDisplayScore = (prevDisplayScore, nextScore, options = {}) => {
  if (typeof prevDisplayScore !== 'number' || !Number.isFinite(prevDisplayScore)) {
    return clamp(Math.round(nextScore));
  }

  const diff = Math.abs(nextScore - prevDisplayScore);
  const latestReportAgeMins =
    typeof options?.latestReportAgeMins === 'number' && Number.isFinite(options.latestReportAgeMins)
      ? options.latestReportAgeMins
      : null;
  const reportCount =
    typeof options?.reportCount === 'number' && Number.isFinite(options.reportCount)
      ? options.reportCount
      : 0;
  const hasVeryFreshCrowdSignal = latestReportAgeMins != null && latestReportAgeMins <= 10 && reportCount > 0;

  let previousWeight = 0.65;
  let nextWeight = 0.35;

  if (diff >= 25) {
    if (hasVeryFreshCrowdSignal) {
      previousWeight = 0.1;
      nextWeight = 0.9;
    } else {
      previousWeight = 0.35;
      nextWeight = 0.65;
    }
  } else if (diff >= 10) {
    if (hasVeryFreshCrowdSignal) {
      previousWeight = 0.25;
      nextWeight = 0.75;
    } else {
      previousWeight = 0.4;
      nextWeight = 0.6;
    }
  }

  return clamp(Math.round(prevDisplayScore * previousWeight + nextScore * nextWeight));
};

export const blendWithCrowdsource = (engineScore, reportOrReports) => {
  const reports = Array.isArray(reportOrReports)
    ? reportOrReports
    : reportOrReports
      ? [reportOrReports]
      : [];

  const crowd = aggregateCrowdReports(reports);
  const pattern = aggregateHistoricalPattern(reports, new Date(), TEACHING_DAY);
  return combineScores({ engineScore, crowd, pattern }).finalScore;
};

export const predictAvailabilityTimeline = ({
  lot,
  weatherCode,
  startDate = new Date(),
  reports = [],
  hours = 24,
  signalResolver = () => ({}),
}) => {
  if (!lot || hours <= 0) {
    return [];
  }

  const now = startDate instanceof Date ? startDate : new Date(startDate || Date.now());
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const rawScores = Array.from({ length: hours }, (_, hour) => {
    const targetDate = new Date(now);
    targetDate.setHours(hour, hour === currentHour ? currentMinute : 0, 0, 0);
    const signalContext = signalResolver(targetDate) || {};

    return predictAvailability({
      lot,
      weatherCode,
      atDate: targetDate,
      reports,
      ...signalContext,
    }).score;
  });
  const carryStrength = getTimelineRecentCrowdCarryStrength(reports, now);

  return applyTimelineFutureCarry(rawScores, currentHour, carryStrength);
};

export const predictAvailability = ({
  lot,
  weatherCode,
  atDate,
  reports = [],
  campusLoadIndex = null,
  academicDayType = 'TEACHING_DAY',
  closureState = 'OPEN',
  prevDisplayScore = null,
}) => {
  const engine = predictEngineScore({
    lot,
    weatherCode,
    atDate,
    campusLoadIndex,
    academicDayType,
    closureState,
  });
  const evaluationDate = atDate || new Date();
  const crowd = aggregateCrowdReports(reports, evaluationDate);
  const pattern = aggregateHistoricalPattern(reports, evaluationDate, academicDayType);
  const mixed = combineScores({
    engineScore: engine.score,
    crowd,
    pattern,
  });
  const displayScore = smoothDisplayScore(prevDisplayScore, mixed.finalScore, {
    latestReportAgeMins: crowd.latestReportAgeMins,
    reportCount: crowd.reportCount,
  });

  return {
    engineScore: engine.score,
    engineStatus: engine.status,
    engineFactors: engine.factors,
    crowdScore: crowd.crowdScore,
    crowdStatus: crowd.crowdScore == null ? 'UNKNOWN' : scoreToStatus(crowd.crowdScore),
    crowdConfidence: crowd.crowdConfidence,
    crowdAlpha: mixed.alpha,
    patternScore: pattern.patternScore,
    patternConfidence: pattern.patternConfidence,
    patternSampleCount: pattern.patternSampleCount,
    latestReportAgeMins: crowd.latestReportAgeMins,
    latestReportAt: crowd.latestReportAt,
    reportCount: crowd.reportCount,
    finalScore: mixed.finalScore,
    finalStatus: scoreToStatus(mixed.finalScore),
    displayScore,
    score: displayScore,
    status: scoreToStatus(displayScore),
  };
};
