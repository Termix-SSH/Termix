/* eslint-disable react-refresh/only-export-components */
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useActionSlot } from "@/hooks/use-action-slot";
import {
  getActionOwner,
  getActionSlot,
  invokeAction,
  type SlotContribution,
} from "@/shell/action-registry";
import type { HostBadgeDef } from "@/sidebar/host-contributions";
import type { Host } from "@/types/ui-types";
import { DataValues, type DataLayout } from "./DataValues";
import { parseDataValue, type DataValue } from "./data-value";
import { getFrameDataSource, type ShownValue } from "./data-source";

type Values = Record<string, DataValue[] | null>;

/** One stable report callback per contribution id. */
function useReports(): [
  Values,
  (id: string) => (v: DataValue[] | null) => void,
] {
  const [values, setValues] = useState<Values>({});
  const reports = useRef(new Map<string, (v: DataValue[] | null) => void>());
  const reportFor = useCallback((id: string) => {
    let report = reports.current.get(id);
    if (!report) {
      report = (value) =>
        setValues((current) => {
          const before = current[id] ?? null;
          if (JSON.stringify(before) === JSON.stringify(value)) return current;
          return { ...current, [id]: value };
        });
      reports.current.set(id, report);
    }
    return report;
  }, []);
  return [values, reportFor];
}

/** Runs a value's action only when it belongs to the plugin that sent it. */
export function runOwnAction(
  pluginId: string | undefined,
  actionId: string,
  args: unknown[],
): void {
  if (!pluginId || getActionOwner(actionId) !== pluginId) {
    console.warn(`[data] ${pluginId ?? "?"} can't run "${actionId}"`);
    return;
  }
  invokeAction(actionId, ...args).catch((error) =>
    console.error(`[data] ${actionId} failed`, error),
  );
}

/** Keeps one object while its JSON stays the same, so reporters don't churn. */
function useStable<T>(value: T): T {
  const ref = useRef<{ json: string; value: T } | null>(null);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return value;
  }
  if (!ref.current || ref.current.json !== json) ref.current = { json, value };
  return ref.current.value;
}

type DataContribution = SlotContribution & {
  value: NonNullable<SlotContribution["value"]>;
};

/**
 * Runs every data contribution's hook for one row and collects the checked
 * values. `reporters` must be rendered for the hooks to run.
 */
export function useDataSlotValues(
  slotId: string,
  rowKey: string | number,
  context: Record<string, unknown> | undefined,
  when?: Record<string, unknown>,
): {
  reporters: ReactNode;
  shown: ShownValue[];
  legacy: SlotContribution[];
  context: Record<string, unknown>;
} {
  const contributions = useActionSlot(slotId, when ?? context);
  const data = contributions.filter(
    (item): item is DataContribution => item.kind === "data" && !!item.value,
  );
  const legacy = contributions.filter(
    (item) => item.kind === "component" && item.component,
  );
  const [values, reportFor] = useReports();
  const row = String(rowKey);
  const shapes = getActionSlot(slotId)?.shapes;
  const stableContext = useStable(context ?? {});

  const shown = data.flatMap((item) => {
    const parts = parseDataValue(values[item.actionId], shapes);
    return parts
      ? [{ actionId: item.actionId, pluginId: item.pluginId, parts }]
      : [];
  });

  const reporters = data.map((item) => {
    const Reporter = item.value;
    return (
      <Reporter
        key={item.actionId}
        context={stableContext}
        rowKey={row}
        report={reportFor(item.actionId)}
      />
    );
  });

  return { reporters, shown, legacy, context: stableContext };
}

export interface DataSlotProps {
  slotId: string;
  /** The host id or tab id. */
  rowKey: string | number;
  /** Passed to each value hook, and to `when` unless `when` is given. */
  context?: Record<string, unknown>;
  when?: Record<string, unknown>;
  /** Shown when no plugin has a value for this row. */
  fallback?: ReactNode;
  layout?: DataLayout;
  className?: string;
}

/**
 * Draws the data contributions in a slot for one row (a host or a tab).
 * Each plugin's value hook runs where the plugin lives, so a framed plugin
 * costs no iframe per row. Component contributions from plugins that have not
 * moved yet still render after the values. Inside a plugin frame the shell
 * runs the hooks and sends the values in.
 */
export function DataSlot(props: DataSlotProps) {
  return getFrameDataSource() ? (
    <FrameDataSlot {...props} />
  ) : (
    <PageDataSlot {...props} />
  );
}

// The fallback hides itself once any value in the slot drew, in CSS, so a
// value arriving never sets state in the slot.
const SLOT_CLASS =
  "contents [&:has([data-data-view])>[data-data-fallback]]:hidden";

function PageDataSlot({
  slotId,
  rowKey,
  context,
  when,
  fallback = null,
  layout = "row",
  className,
}: DataSlotProps) {
  const contributions = useActionSlot(slotId, when ?? context);
  const data = contributions.filter(
    (item): item is DataContribution => item.kind === "data" && !!item.value,
  );
  const legacy = contributions.filter(
    (item) => item.kind === "component" && item.component,
  );
  const stableContext = useStable(context ?? {});
  const shapes = getActionSlot(slotId)?.shapes;
  const row = String(rowKey);
  // Each reporter draws its own values, so a new value renders only its row.
  return (
    <span className={SLOT_CLASS} data-data-slot={slotId}>
      {data.map((item) => {
        const Reporter = item.value;
        return (
          <Reporter
            key={item.actionId}
            context={stableContext}
            rowKey={row}
            shapes={shapes}
            draw={(parts) => (
              <DataValues
                values={parts}
                layout={layout}
                className={className}
                onAction={(actionId) =>
                  runOwnAction(item.pluginId, actionId, [stableContext])
                }
              />
            )}
          />
        );
      })}
      {legacy.length === 0 && fallback != null && (
        <span className="contents" data-data-fallback>
          {fallback}
        </span>
      )}
      {legacy.map((item) => {
        const Contributed = item.component!;
        return (
          <Contributed
            key={item.actionId}
            {...stableContext}
            fallback={data.length > 0 ? null : fallback}
          />
        );
      })}
    </span>
  );
}

function FrameDataSlot({
  slotId,
  rowKey,
  context,
  fallback = null,
  layout = "row",
  className,
}: DataSlotProps) {
  const [shown, setShown] = useState<ShownValue[]>([]);
  const [handle, setHandle] = useState<{
    action: (actionId: string) => void;
  } | null>(null);
  const stableContext = useStable(context ?? {});
  const row = String(rowKey);
  useEffect(() => {
    const source = getFrameDataSource();
    if (!source) return;
    const watch = source.watch(
      { slotId, rowKey: row, context: stableContext },
      (values) =>
        setShown(
          values.flatMap((value) => {
            const parts = parseDataValue(value.parts);
            return parts ? [{ ...value, parts }] : [];
          }),
        ),
    );
    setHandle(watch);
    return () => {
      watch.stop();
      setShown([]);
    };
  }, [slotId, row, stableContext]);
  if (shown.length === 0) return <>{fallback}</>;
  return (
    <>
      {shown.map((item) => (
        <DataValues
          key={item.actionId}
          values={item.parts}
          layout={layout}
          className={className}
          onAction={handle ? (actionId) => handle.action(actionId) : undefined}
        />
      ))}
    </>
  );
}

/**
 * Draws host badges, status indicators or editor toolbar items for one host:
 * plain values through DataValues, and components from in-page plugins as is.
 * Dot only badges are left to the row's dot group.
 */
export function HostDataItems({
  host,
  items,
  layout = "row",
  className,
}: {
  host: Host;
  items: HostBadgeDef[];
  layout?: DataLayout;
  className?: string;
}) {
  const context = useMemo(() => ({ host }), [host]);
  const row = String(host.id);
  return (
    <>
      {items.map((item) => {
        const Reporter = item.value;
        const Component = item.component;
        return (
          <Fragment key={item.id}>
            {Reporter && (
              <Reporter
                context={context}
                rowKey={row}
                draw={(parts) => (
                  <DataValues
                    values={parts}
                    layout={layout}
                    className={className}
                    onAction={(actionId) =>
                      runOwnAction(item.pluginId, actionId, [host])
                    }
                  />
                )}
              />
            )}
            {Component && <Component host={host} />}
          </Fragment>
        );
      })}
    </>
  );
}
