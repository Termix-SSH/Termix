import { parseServerTime } from "@/lib/server-time";

export function formatTimestamp(ts: string, rangeMs: number): string {
  const d = parseServerTime(ts);
  // A live chart covers a minute or two, so minutes alone would repeat.
  if (rangeMs <= 10 * 60 * 1000) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (rangeMs <= 25 * 60 * 60 * 1000) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

// Rough width of a 10px label, used to keep x labels apart.
const CHAR_W = 6.2;
const LABEL_GAP = 12;

/**
 * Picks which timestamps get an x label. The count follows the chart width and
 * label length, and a label that would touch its neighbour is dropped.
 */
export function pickXTicks(
  timestamps: string[],
  rangeMs: number,
  chartW: number,
): number[] {
  const n = timestamps.length;
  if (n < 2 || chartW <= 0) return [];
  const labelW = (i: number) =>
    formatTimestamp(timestamps[i], rangeMs).length * CHAR_W;
  const widest = Math.max(labelW(0), labelW(n - 1));
  const fit = Math.floor((chartW + LABEL_GAP) / (widest + LABEL_GAP));
  const count = Math.max(1, Math.min(5, n, fit));
  const candidates =
    count === 1
      ? [n - 1]
      : Array.from({ length: count }, (_, k) =>
          Math.round((k / (count - 1)) * (n - 1)),
        );

  // Box of a label as drawn: first is start anchored, last end, others middle.
  const box = (i: number): [number, number] => {
    const x = (i / (n - 1)) * chartW;
    const w = labelW(i);
    if (i === 0) return [x, x + w];
    if (i === n - 1) return [x - w, x];
    return [x - w / 2, x + w / 2];
  };

  const clashes = (a: number | undefined, b: number) =>
    a !== undefined && box(a)[1] + LABEL_GAP > box(b)[0];
  const placed: number[] = [];
  for (const i of [...new Set(candidates)]) {
    // The newest time stays visible on a live chart, older labels make room.
    if (i === n - 1) {
      while (placed.length && clashes(placed[placed.length - 1], i)) {
        placed.pop();
      }
    } else if (clashes(placed[placed.length - 1], i)) {
      continue;
    }
    placed.push(i);
  }
  return placed;
}
