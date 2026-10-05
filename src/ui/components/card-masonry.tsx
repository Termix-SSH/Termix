/* eslint-disable react-refresh/only-export-components */
import {
  Children,
  Fragment,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type React from "react";
import { PANEL } from "@/components/panel-layout";
import { cn } from "@/lib/utils";

/** Column counts per container width tier, for each column preference. */
const COLUMN_STEPS: Record<number, [number, number, number, number]> = {
  1: [1, 1, 1, 1],
  2: [1, 2, 2, 2],
  3: [1, 2, 3, 3],
  4: [1, 2, 3, 4],
};

const TIERS = { md: 640, lg: 960, xl: 1240 };

/** How many columns fit a container of this width for a column preference. */
export function masonryColumns(width: number, columns: number): number {
  const steps = COLUMN_STEPS[columns] ?? COLUMN_STEPS[3];
  if (width >= TIERS.xl) return steps[3];
  if (width >= TIERS.lg) return steps[2];
  if (width >= TIERS.md) return steps[1];
  return steps[0];
}

function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement(child) && child.type === Fragment
      ? flattenChildren(
          (child.props as { children?: React.ReactNode }).children,
        )
      : [child],
  );
}

/**
 * Cards dealt round-robin into columns that stack tight. The assignment only
 * depends on child order and column count, so live updates never reshuffle
 * cards between columns. Width comes from the container, not the window, so
 * split panes and docks get the right count.
 */
export function CardMasonry({
  columns,
  stack = false,
  className,
  children,
}: {
  columns: number;
  /** Force one full-width column, for cards holding wide tables. */
  stack?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const count = stack ? 1 : masonryColumns(width, columns);
  const items = useMemo(() => flattenChildren(children), [children]);
  const buckets = useMemo(() => {
    const next: React.ReactNode[][] = Array.from({ length: count }, () => []);
    items.forEach((child, i) => next[i % count].push(child));
    return next;
  }, [items, count]);

  return (
    <div
      ref={ref}
      className={cn(
        count === 1
          ? `flex flex-col ${PANEL.gap}`
          : `flex items-start ${PANEL.gap}`,
        className,
      )}
    >
      {count === 1
        ? items
        : buckets.map((bucket, i) => (
            <div
              key={i}
              className={`flex min-w-0 flex-1 flex-col ${PANEL.gap}`}
            >
              {bucket}
            </div>
          ))}
    </div>
  );
}
