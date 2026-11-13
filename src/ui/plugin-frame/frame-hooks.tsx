/* eslint-disable react-refresh/only-export-components */
/**
 * Runs a plugin's small hooks (rail badge and status, host dots, companion
 * defaults) inside the background frame and sends their values to the
 * shell, which draws them. The hooks run under the plugin's scope like any
 * of its components.
 */

import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { useFrameState } from "./frame-store";

export interface HookSpec {
  key: string;
  use: (...args: never[]) => unknown;
  /** Called once per host with that host, as useDot is. */
  perHost?: boolean;
}

const specs = new Map<string, HookSpec>();
const listeners = new Set<() => void>();
let snapshot: HookSpec[] = [];

function emit() {
  snapshot = [...specs.values()];
  for (const listener of [...listeners]) listener();
}

export function addHook(spec: HookSpec): void {
  specs.set(spec.key, spec);
  emit();
}

export function removeHook(key: string): void {
  if (specs.delete(key)) emit();
}

function useSpecs(): HookSpec[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => snapshot,
  );
}

type Send = (key: string, value: unknown) => void;

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Only real changes cross the frame edge. */
function makeSender(send: Send): Send {
  const last = new Map<string, unknown>();
  return (key, value) => {
    if (last.has(key) && sameValue(last.get(key), value)) return;
    last.set(key, value);
    send(key, value);
  };
}

const PlainHook = memo(function PlainHook({
  spec,
  send,
}: {
  spec: HookSpec;
  send: Send;
}) {
  const value = (spec.use as () => unknown)();
  const json = safeJson(value);
  useEffect(() => {
    send(spec.key, json === undefined ? null : JSON.parse(json));
  }, [spec.key, json, send]);
  return null;
});

const HostHook = memo(function HostHook({
  spec,
  host,
  report,
}: {
  spec: HookSpec;
  host: Record<string, unknown>;
  report: (hostId: string, value: unknown) => void;
}) {
  const value = (spec.use as (host: unknown) => unknown)(host);
  const json = safeJson(value);
  const hostId = String(host.id);
  useEffect(() => {
    report(hostId, json === undefined ? null : JSON.parse(json));
  }, [hostId, json, report]);
  useEffect(() => () => report(hostId, undefined), [hostId, report]);
  return null;
});

function safeJson(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function PerHostHooks({ spec, send }: { spec: HookSpec; send: Send }) {
  const hosts = useFrameState((state) => state.hosts);
  // Collected per host, then sent as one table.
  const table = useMemo(() => makeTable(spec.key, send), [spec.key, send]);
  return (
    <>
      {hosts.map((host) => (
        <HostHook
          key={String(host.id)}
          spec={spec}
          host={host}
          report={table}
        />
      ))}
    </>
  );
}

const tables = new Map<string, Record<string, unknown>>();

function makeTable(key: string, send: Send) {
  return (hostId: string, value: unknown) => {
    const current = { ...(tables.get(key) ?? {}) };
    if (value === undefined || value === null) delete current[hostId];
    else current[hostId] = value;
    tables.set(key, current);
    send(key, current);
  };
}

/** Renders every hook the plugin registered. Background frame only. */
export function FrameHooks({ send }: { send: Send }) {
  const list = useSpecs();
  const sender = useStableSender(send);
  return (
    <>
      {list.map((spec) =>
        spec.perHost ? (
          <PerHostHooks key={spec.key} spec={spec} send={sender} />
        ) : (
          <PlainHook key={spec.key} spec={spec} send={sender} />
        ),
      )}
    </>
  );
}

let stable: { send: Send; wrapped: Send } | null = null;

function useStableSender(send: Send): Send {
  if (!stable || stable.send !== send) {
    stable = { send, wrapped: makeSender(send) };
  }
  return stable.wrapped;
}
