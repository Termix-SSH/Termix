/** Pure geometry helpers for the chart primitives (unit-tested). */

export const SPARKLINE_VIEW_W = 300;

export interface SparklineGeometry {
  hasData: boolean;
  coords: Array<readonly [number, number]>;
  linePath: string;
  areaPath: string;
}

/**
 * Map a value series to SVG coordinates within [0..VIEW_W] x [0..height].
 * A fixed `domain` keeps the y-axis stable (no per-tick rescaling).
 */
export function sparklineGeometry(
  data: Array<number | null | undefined>,
  height: number,
  domain?: [number, number],
): SparklineGeometry {
  const points = data.map((v) =>
    typeof v === "number" && isFinite(v) ? v : 0,
  );
  const hasData = points.length >= 2;
  if (!hasData)
    return { hasData: false, coords: [], linePath: "", areaPath: "" };

  const lo = domain ? domain[0] : Math.min(...points);
  const hiRaw = domain ? domain[1] : Math.max(...points);
  const hi = hiRaw === lo ? lo + 1 : hiRaw;
  const range = hi - lo;

  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * SPARKLINE_VIEW_W;
    const clamped = Math.min(hi, Math.max(lo, v));
    const y = height - ((clamped - lo) / range) * height;
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  return {
    hasData: true,
    coords,
    linePath: `M ${line}`,
    areaPath: `M 0,${height} L ${line} L ${SPARKLINE_VIEW_W},${height} Z`,
  };
}

export interface GaugeArc {
  trackLen: number;
  valueLen: number;
  circumference: number;
}

/** Arc lengths for a radial gauge sweeping `sweepDeg` degrees. */
export function gaugeArc(
  value: number | null,
  radius: number,
  sweepDeg = 270,
): GaugeArc {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * radius;
  const trackLen = circumference * (sweepDeg / 360);
  const valueLen = trackLen * (pct / 100);
  return { trackLen, valueLen, circumference };
}
