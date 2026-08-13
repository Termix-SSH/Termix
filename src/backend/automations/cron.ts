/**
 * A small five field cron parser, used only to work out when a schedule is
 * next due.
 *
 * Deliberately not a dependency: the engine needs "when is this next due?" and
 * nothing else, and a pure function is far easier to test than a scheduler
 * library. Fields are the standard minute, hour, day-of-month, month and
 * day-of-week, supporting *, lists (1,2), ranges (1-5) and steps (a slash).
 *
 * Day-of-month and day-of-week follow cron's union rule: when both are
 * restricted, a date matching either one matches.
 */

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  // 7 is accepted as an alias for Sunday and folded to 0 once parsed.
  dayOfWeek: [0, 7],
};

const NAMED_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const NAMED_DAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function normalize(token: string, kind: string): string {
  const lower = token.toLowerCase();
  if (kind === "month" && lower in NAMED_MONTHS) {
    return String(NAMED_MONTHS[lower]);
  }
  if (kind === "dayOfWeek" && lower in NAMED_DAYS) {
    return String(NAMED_DAYS[lower]);
  }
  return token;
}

function parseField(field: string, kind: keyof typeof RANGES): Set<number> {
  const [min, max] = RANGES[kind];
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`Empty value in ${kind} field`);

    const [rangePart, stepPart] = trimmed.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid step in ${kind} field`);
    }

    let start: number;
    let end: number;

    if (rangePart === "*" || rangePart === "") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [from, to] = rangePart.split("-");
      start = Number(normalize(from, kind));
      end = Number(normalize(to, kind));
    } else {
      start = Number(normalize(rangePart, kind));
      end = stepPart === undefined ? start : max;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new Error(`Invalid value in ${kind} field`);
    }
    if (start < min || end > max || start > end) {
      throw new Error(`Value out of range in ${kind} field`);
    }

    for (let value = start; value <= end; value += step) {
      // Sunday can be written as 7; cron treats it as 0.
      values.add(kind === "dayOfWeek" && value === 7 ? 0 : value);
    }
  }

  return values;
}

export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("A cron expression needs five fields");
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return {
    minutes: parseField(minute, "minute"),
    hours: parseField(hour, "hour"),
    daysOfMonth: parseField(dayOfMonth, "dayOfMonth"),
    months: parseField(month, "month"),
    daysOfWeek: parseField(dayOfWeek, "dayOfWeek"),
    domRestricted: dayOfMonth.trim() !== "*",
    dowRestricted: dayOfWeek.trim() !== "*",
  };
}

export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

function matches(fields: CronFields, date: Date): boolean {
  if (!fields.months.has(date.getMonth() + 1)) return false;
  if (!fields.minutes.has(date.getMinutes())) return false;
  if (!fields.hours.has(date.getHours())) return false;

  const domMatch = fields.daysOfMonth.has(date.getDate());
  const dowMatch = fields.daysOfWeek.has(date.getDay());

  // Both restricted means either may match, which is how cron behaves.
  if (fields.domRestricted && fields.dowRestricted) return domMatch || dowMatch;
  if (fields.domRestricted) return domMatch;
  if (fields.dowRestricted) return dowMatch;
  return true;
}

/**
 * The next time on or after `from` that the expression matches, or null when
 * nothing matches within a four year window (e.g. Feb 30).
 */
export function nextCronRun(
  expression: string,
  from: Date = new Date(),
): Date | null {
  const fields = parseCron(expression);

  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Four years covers every leap year cycle, so a date that never matches
  // gives up rather than looping.
  const limit = 366 * 4 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (matches(fields, candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

/**
 * Next due time for a schedule trigger, as an ISO string. Interval wins over
 * cron when both are set, matching the editor which offers one or the other.
 */
export function computeNextDueAt(
  schedule: { cron?: string | null; intervalSeconds?: number | null },
  from: Date = new Date(),
): string | null {
  if (schedule.intervalSeconds && schedule.intervalSeconds > 0) {
    return new Date(
      from.getTime() + schedule.intervalSeconds * 1000,
    ).toISOString();
  }
  if (schedule.cron) {
    const next = nextCronRun(schedule.cron, from);
    return next ? next.toISOString() : null;
  }
  return null;
}
