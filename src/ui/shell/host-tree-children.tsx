/* eslint-disable react-refresh/only-export-components */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Host } from "@/types/ui-types";
import { byOrderThenId, createRegistry } from "@/lib/registry";

export type HostTreeChildKind = "container" | "vm" | "lxc" | "pod" | "other";
export type HostTreeChildState = "running" | "stopped" | "paused" | "unknown";

/** Something inside a host, like a container or a guest, shown under it. */
export interface HostTreeChild {
  id: string;
  label: string;
  detail?: string;
  kind?: HostTreeChildKind;
  state?: HostTreeChildState;
  /** The tab a click opens on the parent host, with data saying what to show. */
  tabType: string;
  data?: Record<string, unknown>;
}

export interface HostTreeChildrenResult {
  items: HostTreeChild[];
  loading?: boolean;
  error?: string;
}

/** Runs a plugin's useChildren hook for one host and reports the answer. */
export type HostTreeChildrenReporter = ComponentType<{
  host: Host;
  report: (value: HostTreeChildrenResult | null) => void;
}>;

export interface HostTreeChildrenDef {
  id: string;
  pluginId?: string;
  titleKey?: string;
  order?: number;
  when: (host: Host) => boolean;
  reporter: HostTreeChildrenReporter;
}

const providers = createRegistry<HostTreeChildrenDef>(byOrderThenId);

export const registerHostTreeChildren = providers.register;
export const useHostTreeChildrenProviders = providers.useList;
export const listHostTreeChildrenProviders = providers.list;
export const resetHostTreeChildren = providers.reset;

const KINDS = new Set(["container", "vm", "lxc", "pod", "other"]);
const STATES = new Set(["running", "stopped", "paused", "unknown"]);
const MAX_ITEMS = 500;

const text = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;

/** Keeps only well formed plain data, so a plugin can't hand the tree junk. */
export function parseHostTreeChildren(
  raw: unknown,
): HostTreeChildrenResult | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const list = Array.isArray(value.items) ? value.items : [];
  const items: HostTreeChild[] = [];
  for (const entry of list.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const id = text(item.id, 200);
    const label = text(item.label, 200);
    const tabType = text(item.tabType, 100);
    if (!id || !label || !tabType) continue;
    let data: Record<string, unknown> | undefined;
    if (
      item.data &&
      typeof item.data === "object" &&
      !Array.isArray(item.data)
    ) {
      try {
        data = JSON.parse(JSON.stringify(item.data)) as Record<string, unknown>;
      } catch {
        data = undefined;
      }
    }
    items.push({
      id,
      label,
      detail: text(item.detail, 200),
      kind: KINDS.has(item.kind as string)
        ? (item.kind as HostTreeChildKind)
        : undefined,
      state: STATES.has(item.state as string)
        ? (item.state as HostTreeChildState)
        : undefined,
      tabType,
      data,
    });
  }
  return {
    items,
    loading: value.loading === true,
    error: text(value.error, 300),
  };
}

/** Turns a plugin's useChildren hook into a reporter the tree can mount. */
export function hostTreeChildrenReporter(
  useChildren: (host: Host) => unknown,
): HostTreeChildrenReporter {
  return function HostTreeChildrenReport({ host, report }) {
    const raw = useChildren(host);
    let json = "null";
    try {
      json = JSON.stringify(parseHostTreeChildren(raw));
    } catch {
      json = "null";
    }
    useEffect(() => {
      report(JSON.parse(json) as HostTreeChildrenResult | null);
    }, [json, report]);
    useEffect(() => () => report(null), [report]);
    return null;
  };
}

export function hostTreeChildrenFor(
  all: HostTreeChildrenDef[],
  host: Host,
): HostTreeChildrenDef[] {
  return all.filter((provider) => {
    try {
      return provider.when(host);
    } catch {
      return false;
    }
  });
}

const providerKey = (provider: HostTreeChildrenDef) =>
  `${provider.pluginId ?? ""}:${provider.id}`;

export interface HostTreeChildrenGroup {
  providerId: string;
  pluginId?: string;
  titleKey?: string;
  result: HostTreeChildrenResult | null;
}

function ProviderMount({
  provider,
  host,
  onReport,
}: {
  provider: HostTreeChildrenDef;
  host: Host;
  onReport: (id: string, value: HostTreeChildrenResult | null) => void;
}) {
  const report = useCallback(
    (value: HostTreeChildrenResult | null) =>
      onReport(providerKey(provider), value),
    [onReport, provider],
  );
  const Reporter = provider.reporter;
  return <Reporter host={host} report={report} />;
}

/**
 * Asks every plugin that lists things inside this host and hands the answers
 * to `children`. Mount it only for a host that is expanded: each provider
 * may load data while it is mounted.
 */
export function HostTreeChildren({
  host,
  children,
}: {
  host: Host;
  children: (groups: HostTreeChildrenGroup[]) => ReactNode;
}) {
  const all = useHostTreeChildrenProviders();
  const active = useMemo(() => hostTreeChildrenFor(all, host), [all, host]);
  const [results, setResults] = useState<
    Record<string, HostTreeChildrenResult | null>
  >({});
  const onReport = useCallback(
    (id: string, value: HostTreeChildrenResult | null) =>
      setResults((current) =>
        current[id] === value ? current : { ...current, [id]: value },
      ),
    [],
  );
  const groups = active.map((provider) => ({
    providerId: provider.id,
    pluginId: provider.pluginId,
    titleKey: provider.titleKey,
    result: results[providerKey(provider)] ?? null,
  }));
  return (
    <>
      {active.map((provider) => (
        <ProviderMount
          key={providerKey(provider)}
          provider={provider}
          host={host}
          onReport={onReport}
        />
      ))}
      {children(groups)}
    </>
  );
}
