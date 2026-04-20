import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPORTANT_DATES_URL = 'https://www.dal.ca/academics/important_dates.html';
const TIMETABLE_BASE = 'https://self-service.dal.ca/BannerExtensibility/internalPb';
const CURRENT_TERM_HINT = 'Winter';
const DISTRICTS_ALL = '100;200;300;400;';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputFile = path.resolve(__dirname, '../src/data/officialPredictionSignals.js');

const toBase64 = (value) => Buffer.from(String(value), 'utf8').toString('base64');

const encodeParam = (key, value) =>
  `${encodeURIComponent(toBase64(Math.round(Math.random() * 99)) + toBase64(key))}=${encodeURIComponent(
    toBase64(Math.round(Math.random() * 99)) + toBase64(value)
  )}`;

const requestDataset = async (dataset, params = {}) => {
  const query = Object.entries(params)
    .map(([key, value]) => encodeParam(key, value))
    .concat('encoded=true')
    .join('&');

  const response = await fetch(`${TIMETABLE_BASE}/${dataset}?${query}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${dataset}: ${response.status}`);
  }

  return response.json();
};

const stripHtml = (value = '') =>
  value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const padDate = (value) => String(value).padStart(2, '0');

const monthNames = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const parseDateLabel = (label, fallbackYear = 2026) => {
  const cleaned = stripHtml(label).replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*/gi, '');
  const parts = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})(?:\s*-\s*(?:[A-Za-z]+\s+)?(\d{1,2}))?(?:,\s*(\d{4}))?/);
  if (!parts) {
    return null;
  }

  const monthIndex = monthNames[parts[1]];
  if (monthIndex == null) {
    return null;
  }

  const startDay = Number(parts[2]);
  const endDay = Number(parts[3] || parts[2]);
  const year = Number(parts[4] || fallbackYear);

  return {
    start: new Date(Date.UTC(year, monthIndex, startDay, 0, 0, 0, 0)),
    end: new Date(Date.UTC(year, monthIndex, endDay, 23, 59, 59, 999)),
  };
};

const mapCalendarEntryToSignal = (dateRange, entryText) => {
  const lower = entryText.toLowerCase();

  if (lower.includes('winter break')) {
    return { type: 'WINTER_BREAK', startAt: dateRange.start.getTime(), endAt: dateRange.end.getTime() };
  }

  if (lower.includes('reading week')) {
    return { type: 'READING_WEEK', startAt: dateRange.start.getTime(), endAt: dateRange.end.getTime() };
  }

  if (lower.includes('university closed') || lower.includes('good friday')) {
    return { type: 'UNIVERSITY_CLOSED', startAt: dateRange.start.getTime(), endAt: dateRange.end.getTime() };
  }

  if (lower.includes('friday classes will be held')) {
    return { type: 'FRIDAY_SCHEDULE_OVERRIDE', startAt: dateRange.start.getTime(), endAt: dateRange.end.getTime() };
  }

  if (lower.includes('examinations begin')) {
    return {
      type: 'EXAM_PERIOD',
      startAt: dateRange.start.getTime(),
      endAt: dateRange.start.getTime(),
      phase: 'START',
    };
  }

  if (lower.includes('examinations end')) {
    return {
      type: 'EXAM_PERIOD',
      startAt: dateRange.end.getTime(),
      endAt: dateRange.end.getTime(),
      phase: 'END',
    };
  }

  return null;
};

const parseAcademicCalendarSignals = async () => {
  const response = await fetch(IMPORTANT_DATES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch important dates: ${response.status}`);
  }

  const html = await response.text();
  const pairRegex = /<p><b[^>]*>(.*?)<\/b>(?:<br\s*\/?>)?\s*<\/p>\s*<ul>([\s\S]*?)<\/ul>/g;
  const listItemRegex = /<li>([\s\S]*?)<\/li>/g;
  const rawSignals = [];
  let pairMatch;

  while ((pairMatch = pairRegex.exec(html)) !== null) {
    const dateRange = parseDateLabel(pairMatch[1]);
    if (!dateRange) {
      continue;
    }

    let itemMatch;
    while ((itemMatch = listItemRegex.exec(pairMatch[2])) !== null) {
      const itemText = stripHtml(itemMatch[1]);
      const signal = mapCalendarEntryToSignal(dateRange, itemText);
      if (signal) {
        rawSignals.push(signal);
      }
    }
  }

  const examStart = rawSignals.find((signal) => signal.type === 'EXAM_PERIOD' && signal.phase === 'START');
  const examEnd = rawSignals.find((signal) => signal.type === 'EXAM_PERIOD' && signal.phase === 'END');
  const examSignal =
    examStart && examEnd
      ? [
          {
            type: 'EXAM_PERIOD',
            startAt: examStart.startAt,
            endAt: examEnd.endAt,
          },
        ]
      : [];
  const dedupedSignals = rawSignals
    .filter((signal) => signal.type !== 'EXAM_PERIOD')
    .concat(examSignal)
    .reduce((accumulator, signal) => {
      const key = `${signal.type}:${signal.startAt}:${signal.endAt}`;
      if (!accumulator.some((entry) => `${entry.type}:${entry.startAt}:${entry.endAt}` === key)) {
        accumulator.push(signal);
      }
      return accumulator;
    }, []);

  return dedupedSignals.sort((left, right) => left.startAt - right.startAt);
};

const pickActiveTerm = async () => {
  const terms = await requestDataset('virtualDomains.dal_stuweb_academicTimetable_terms', {
    offset: 0,
    max: 10,
    in_progress: 'N',
  });

  return (
    terms.find((term) => term.SELECTED === 'Y' && term.DESCR.includes(CURRENT_TERM_HINT)) ||
    terms.find((term) => term.SELECTED === 'Y') ||
    terms.find((term) => term.DESCR.includes(CURRENT_TERM_HINT)) ||
    terms[0]
  );
};

const inferCampusFromLocation = (locationText) => {
  const cleaned = stripHtml(locationText).toLowerCase();
  if (cleaned.includes('studley')) return 'studley';
  if (cleaned.includes('sexton')) return 'sexton';
  return null;
};

const parseTimeRange = (value) => {
  const cleaned = stripHtml(value);
  const match = cleaned.match(/(\d{4})-(\d{4})/);
  if (!match) {
    return null;
  }

  const startHour = Number(match[1].slice(0, 2));
  const endHour = Number(match[2].slice(0, 2));
  const endMinutes = Number(match[2].slice(2, 4));
  return {
    startHour,
    endHour: endMinutes > 0 ? endHour : Math.max(startHour, endHour - 1),
  };
};

const weekdayFieldMap = [
  ['SUNDAYS', 0],
  ['MONDAYS', 1],
  ['TUESDAYS', 2],
  ['WEDNESDAYS', 3],
  ['THURSDAYS', 4],
  ['FRIDAYS', 5],
  ['SATURDAYS', 6],
];

const asyncPool = async (items, worker, concurrency = 8) => {
  const results = [];
  let index = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return results;
};

const buildCampusLoadBuckets = async () => {
  const term = await pickActiveTerm();
  if (!term?.CODE) {
    return { termCode: null, buckets: [] };
  }

  const subjects = await requestDataset('virtualDomains.dal_stuweb_academicTimetable_subjects', {
    terms: `${term.CODE};`,
    districts: DISTRICTS_ALL,
  });

  const subjectCodes = subjects.map((subject) => subject.CODE).filter(Boolean);
  const timetableResponses = await asyncPool(
    subjectCodes,
    async (subjectCode) => {
      const rows = await requestDataset('virtualDomains.dal_stuweb_academicTimetable', {
        terms: `${term.CODE};`,
        subj_code: subjectCode,
        districts: DISTRICTS_ALL,
        page_num: 1,
        crse_numb: '',
        page_size: 9999,
      });

      return Array.isArray(rows) ? rows : [];
    },
    6
  );

  const buckets = new Map();

  timetableResponses.flat().forEach((row) => {
    const campus = inferCampusFromLocation(row.LOCATIONS);
    if (!campus) {
      return;
    }

    const timeRange = parseTimeRange(row.TIMES);
    if (!timeRange) {
      return;
    }

    const enrolled = Number(row.ENRL) || 0;
    const capacity = Number(row.MAX_ENRL) || 0;
    if (!capacity) {
      return;
    }

    weekdayFieldMap.forEach(([field, weekday]) => {
      if (!stripHtml(row[field] || '').length) {
        return;
      }

      for (let hour = timeRange.startHour; hour <= timeRange.endHour; hour += 1) {
        const key = `${campus}:${weekday}:${hour}`;
        const bucket = buckets.get(key) || {
          campus,
          weekday,
          hour,
          sectionCount: 0,
          enrolledSum: 0,
          capacitySum: 0,
        };

        bucket.sectionCount += 1;
        bucket.enrolledSum += enrolled;
        bucket.capacitySum += capacity;
        buckets.set(key, bucket);
      }
    });
  });

  return {
    termCode: term.CODE,
    buckets: Array.from(buckets.values())
      .map((bucket) => ({
        campus: bucket.campus,
        weekday: bucket.weekday,
        hour: bucket.hour,
        sectionCount: bucket.sectionCount,
        enrolledSum: bucket.enrolledSum,
        capacitySum: bucket.capacitySum,
        loadIndex:
          bucket.capacitySum > 0
            ? Math.max(0, Math.min(1, Number((bucket.enrolledSum / bucket.capacitySum).toFixed(4))))
            : 0,
      }))
      .sort((left, right) => {
        if (left.campus !== right.campus) {
          return left.campus.localeCompare(right.campus);
        }
        if (left.weekday !== right.weekday) {
          return left.weekday - right.weekday;
        }
        return left.hour - right.hour;
      }),
  };
};

const buildOutputModule = ({ generatedAt, calendarSignals, campusLoadBuckets, timetableTermCode }) => `export const OFFICIAL_SIGNAL_METADATA = ${JSON.stringify(
  {
    generatedAt,
    timetableTermCode,
    sources: {
      academicCalendar: IMPORTANT_DATES_URL,
      timetable: 'https://self-service.dal.ca/BannerExtensibility/customPage/page/dal.stuweb_academicTimetable',
    },
  },
  null,
  2
)};

export const ACADEMIC_CALENDAR_SIGNALS = ${JSON.stringify(calendarSignals, null, 2)};

export const CAMPUS_LOAD_BUCKETS = ${JSON.stringify(campusLoadBuckets, null, 2)};
`;

const main = async () => {
  const [calendarSignals, campusLoad] = await Promise.all([
    parseAcademicCalendarSignals(),
    buildCampusLoadBuckets(),
  ]);

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(
    outputFile,
    buildOutputModule({
      generatedAt: new Date().toISOString(),
      calendarSignals,
      campusLoadBuckets: campusLoad.buckets,
      timetableTermCode: campusLoad.termCode,
    }),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        outputFile,
        calendarSignalCount: calendarSignals.length,
        campusLoadBucketCount: campusLoad.buckets.length,
        timetableTermCode: campusLoad.termCode,
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
