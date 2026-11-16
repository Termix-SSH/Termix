/**
 * Small values a plugin hands a slot instead of a component: usage bars,
 * numbers, a badge, a dot or a line of text. The shell draws them with
 * DataView, so every plugin looks the same and a framed plugin needs no
 * iframe per row.
 */

export type DataTone = "default" | "good" | "warn" | "bad" | "muted";

export type DataShape = "bars" | "stat" | "badge" | "dot" | "text";

export const DATA_SHAPES: readonly DataShape[] = [
  "bars",
  "stat",
  "badge",
  "dot",
  "text",
];

export interface DataBar {
  label: string;
  /** 0 to 1, or null when not known. */
  value: number | null;
  tone?: DataTone;
  /** Short text after the percent, like "2/8 GiB". */
  detail?: string;
}

export interface DataStat {
  label: string;
  value: string | number | null;
  unit?: string;
  tone?: DataTone;
  tooltip?: string;
}

export type DataValue =
  | { shape: "bars"; items: DataBar[] }
  | { shape: "stat"; items: DataStat[] }
  | {
      shape: "badge";
      label: string;
      tone?: DataTone;
      tooltip?: string;
      /** One of the plugin's own actions, run on click. */
      actionId?: string;
    }
  | { shape: "dot"; tone: DataTone; label: string }
  | {
      shape: "text";
      text: string;
      tone?: DataTone;
      tooltip?: string;
      actionId?: string;
    };

/** What a data hook may return. */
export type DataResult = DataValue | DataValue[] | null | undefined;

const TONES = new Set<DataTone>(["default", "good", "warn", "bad", "muted"]);
const MAX_PARTS = 8;
const MAX_ITEMS = 12;
const MAX_TEXT = 200;
const MAX_TOOLTIP = 1000;

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    value = String(value);
  if (typeof value !== "string") return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function tone(value: unknown): DataTone | undefined {
  return typeof value === "string" && TONES.has(value as DataTone)
    ? (value as DataTone)
    : undefined;
}

function optional<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function bar(raw: unknown): DataBar | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const label = text(item.label);
  if (label === undefined) return null;
  const number =
    typeof item.value === "number" && Number.isFinite(item.value)
      ? Math.max(0, Math.min(1, item.value))
      : null;
  return optional({
    label,
    value: number,
    tone: tone(item.tone),
    detail: text(item.detail),
  });
}

function stat(raw: unknown): DataStat | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const label = text(item.label);
  if (label === undefined) return null;
  const value =
    typeof item.value === "number" && Number.isFinite(item.value)
      ? item.value
      : (text(item.value) ?? null);
  return optional({
    label,
    value,
    unit: text(item.unit),
    tone: tone(item.tone),
    tooltip: text(item.tooltip, MAX_TOOLTIP),
  });
}

function actionId(value: unknown): string | undefined {
  const id = text(value);
  return id && /^[a-z0-9][a-z0-9._:-]*$/i.test(id) ? id : undefined;
}

function part(raw: unknown): DataValue | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  switch (value.shape) {
    case "bars":
    case "stat": {
      if (!Array.isArray(value.items)) return null;
      const parse: (raw: unknown) => object | null =
        value.shape === "bars" ? bar : stat;
      const items = value.items
        .slice(0, MAX_ITEMS)
        .map((item) => parse(item))
        .filter((item) => item !== null);
      return items.length > 0
        ? ({ shape: value.shape, items } as DataValue)
        : null;
    }
    case "badge": {
      const label = text(value.label);
      if (!label) return null;
      return optional({
        shape: "badge" as const,
        label,
        tone: tone(value.tone),
        tooltip: text(value.tooltip, MAX_TOOLTIP),
        actionId: actionId(value.actionId),
      });
    }
    case "dot": {
      const dotTone = tone(value.tone);
      if (!dotTone) return null;
      return {
        shape: "dot",
        tone: dotTone,
        label: text(value.label, MAX_TOOLTIP) ?? "",
      };
    }
    case "text": {
      const body = text(value.text);
      if (!body) return null;
      return optional({
        shape: "text" as const,
        text: body,
        tone: tone(value.tone),
        tooltip: text(value.tooltip, MAX_TOOLTIP),
        actionId: actionId(value.actionId),
      });
    }
    default:
      return null;
  }
}

/**
 * Checks a value from a plugin before it is drawn: unknown shapes and bad
 * items are dropped, bars are clamped to 0..1, text is cut short. Returns
 * null when nothing is left.
 */
export function parseDataValue(
  raw: unknown,
  shapes?: readonly DataShape[],
): DataValue[] | null {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_PARTS) : [raw];
  const parts = list
    .map(part)
    .filter(
      (value): value is DataValue =>
        value !== null && (!shapes || shapes.includes(value.shape)),
    );
  return parts.length > 0 ? parts : null;
}
