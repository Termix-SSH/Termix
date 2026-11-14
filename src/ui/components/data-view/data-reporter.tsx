import { useEffect, useMemo, type ComponentType, type ReactNode } from "react";
import { parseDataValue, type DataShape, type DataValue } from "./data-value";

export interface DataReporterProps {
  /** The slot owner's context for this row. */
  context: Record<string, unknown>;
  /** The host id or tab id the row stands for. */
  rowKey: string;
  /** Shapes the place draws; others are dropped. */
  shapes?: readonly DataShape[];
  /** Draws the checked value in place. */
  draw?: (value: DataValue[]) => ReactNode;
  /** Told only when the row goes between having a value and having none. */
  present?: (has: boolean) => void;
  /** Gets every change of the checked value. */
  report?: (value: DataValue[] | null) => void;
}

/**
 * Mounted once per row and contribution. Calls the value hook and draws the
 * checked answer where it is, so a new value never needs a render of the
 * slot around it.
 */
export type DataReporter = ComponentType<DataReporterProps>;

/** Turns a data hook into a reporter the slot can mount. */
export function dataReporter(
  useValue: (context: Record<string, unknown>, rowKey: string) => unknown,
  shapes?: readonly DataShape[],
): DataReporter {
  return function DataReport({
    context,
    rowKey,
    shapes: placeShapes,
    draw,
    present,
    report,
  }) {
    const raw = useValue(context, rowKey);
    let json = "null";
    try {
      const own = parseDataValue(raw, shapes);
      json = JSON.stringify(own && parseDataValue(own, placeShapes));
    } catch {
      json = "null";
    }
    const value = useMemo(() => JSON.parse(json) as DataValue[] | null, [json]);
    const has = value !== null;
    useEffect(() => {
      report?.(value);
    }, [value, report]);
    useEffect(() => {
      present?.(has);
    }, [has, present]);
    useEffect(
      () => () => {
        report?.(null);
        present?.(false);
      },
      [report, present],
    );
    return value && draw ? <>{draw(value)}</> : null;
  };
}
