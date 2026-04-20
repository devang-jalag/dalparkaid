const toMillis = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
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
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeCampus = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.includes('studley')) return 'studley';
  if (normalized.includes('sexton')) return 'sexton';
  if (normalized.includes('city') || normalized.includes('halifax')) return 'city';
  return null;
};

const getCampusPeakStats = (buckets, campus) => {
  return buckets.reduce(
    (stats, entry) => {
      if (normalizeCampus(entry?.campus) !== campus) {
        return stats;
      }

      const sectionCount = Number(entry?.sectionCount);
      const enrolledSum = Number(entry?.enrolledSum);

      return {
        maxSections: Math.max(stats.maxSections, Number.isFinite(sectionCount) ? sectionCount : 0),
        maxEnrolled: Math.max(stats.maxEnrolled, Number.isFinite(enrolledSum) ? enrolledSum : 0),
      };
    },
    { maxSections: 0, maxEnrolled: 0 }
  );
};

const matchesCampus = (campuses, campus) => {
  if (!Array.isArray(campuses) || campuses.length === 0) {
    return true;
  }

  return campuses.some((entry) => normalizeCampus(entry) === campus);
};

const isActiveAtDate = (entry, dateMs) => {
  const startAt = toMillis(entry?.startAt);
  const endAt = toMillis(entry?.endAt);

  if (startAt != null && dateMs < startAt) {
    return false;
  }

  if (endAt != null && dateMs > endAt) {
    return false;
  }

  return true;
};

export const inferCampusFromLot = (lot) => {
  const directCampus = normalizeCampus(lot?.campus);
  if (directCampus) {
    return directCampus;
  }

  const haystack = `${lot?.name || ''} ${lot?.address || ''}`.toLowerCase();
  if (haystack.includes('sexton')) return 'sexton';
  if (haystack.includes('studley') || haystack.includes('south street') || haystack.includes('university avenue')) {
    return 'studley';
  }

  return 'city';
};

export const resolveAcademicDayType = ({
  date = new Date(),
  lot,
  calendarSignals = [],
}) => {
  const dateMs = toMillis(date) ?? Date.now();
  const campus = inferCampusFromLot(lot);

  const activeSignal = calendarSignals.find(
    (entry) =>
      isActiveAtDate(entry, dateMs) &&
      matchesCampus(entry.campuses ?? (entry.campus ? [entry.campus] : undefined), campus)
  );

  return activeSignal?.type || 'TEACHING_DAY';
};

export const resolveCampusLoadIndex = ({
  date = new Date(),
  lot,
  buckets = [],
}) => {
  const now = date instanceof Date ? date : new Date(date || Date.now());
  const campus = inferCampusFromLot(lot);
  const weekday = now.getDay();
  const hour = now.getHours();

  const activeBucket = buckets.find(
    (entry) =>
      normalizeCampus(entry?.campus) === campus &&
      Number(entry?.weekday) === weekday &&
      Number(entry?.hour) === hour
  );

  const numericLoadIndex = Number(activeBucket?.loadIndex);
  if (Number.isFinite(numericLoadIndex)) {
    const { maxSections, maxEnrolled } = getCampusPeakStats(buckets, campus);
    const sectionCount = Number(activeBucket?.sectionCount);
    const enrolledSum = Number(activeBucket?.enrolledSum);
    const sectionShare =
      maxSections > 0 && Number.isFinite(sectionCount)
        ? Math.max(0, Math.min(1, sectionCount / maxSections))
        : 0;
    const enrollmentShare =
      maxEnrolled > 0 && Number.isFinite(enrolledSum)
        ? Math.max(0, Math.min(1, enrolledSum / maxEnrolled))
        : 0;
    const activityFactor = (sectionShare + enrollmentShare) / 2;

    return Math.max(0, Math.min(1, numericLoadIndex * activityFactor));
  }

  return null;
};

export const resolvePredictionSignals = ({
  date = new Date(),
  lot,
  calendarSignals = [],
  campusLoadBuckets = [],
}) => ({
  campus: inferCampusFromLot(lot),
  academicDayType: resolveAcademicDayType({ date, lot, calendarSignals }),
  campusLoadIndex: resolveCampusLoadIndex({ date, lot, buckets: campusLoadBuckets }),
});
