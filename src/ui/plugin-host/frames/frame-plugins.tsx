/**
 * Runs a framed plugin's frontend.
 *
 * Its activate runs in a hidden background frame, which reports each
 * registration as data. Here every registration is replayed into the same
 * app object an in-page plugin gets (so ids, keys, permissions and host
 * scoping work the same), with components swapped for frame views,
 * functions for calls into the frame, and hooks for values the frame sends.
 *
 * What a plugin registered is cached per user and asset version. With a
 * cache hit the registrations are replayed at boot and the background frame
 * starts only when something needs live code: a hook value, an answer not
 * cached yet, an action, a view of the plugin, or a settings change. A frame
 * that holds no live value stops again after a few idle minutes. Plugins
 * whose frame keeps working on its own (timers, sockets, shell
 * subscriptions started in activate) always run.
 */

import { useEffect, type ComponentType } from "react";
import type { PluginSummary } from "@/api/plugins-api";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/frontend";
import {
  isWireComponent,
  isWireFn,
  type WireComponent,
} from "@/plugin-frame/protocol";
import { decode } from "@/plugin-frame/wire";
import { decodeIconValue } from "@/plugin-frame/frame-icons";
import { getUserInfo } from "@/main-axios";
import { loadMyPermissions } from "@/hooks/use-permissions";
import { createPluginApp, type PluginAppHandle } from "../app";
import {
  connectFrame,
  frameUrl,
  mayCallHandle,
  type FrameConnection,
} from "./frame-connection";
import { SANDBOX, type FrameFit } from "./PluginFrameView";
import { FramedView, SlotFramedView } from "./framed-view";
import { clearFrameValues, setFrameValue, useFrameValue } from "./frame-values";
import { toPluginHostRecord } from "../bridge";
import { addDataRow } from "./data-rows";
import { setFrameMeta } from "./frame-meta";
import { setFrameDemand } from "./frame-demand";
import {
  isPlainValue,
  readCachedPlugin,
  trimAnswers,
  writeCachedPlugin,
} from "./registration-cache";

import { extensionFit } from "./slot-fit";
import { hasUserActivation } from "./user-activation";

export { resolveSlotFit, slotFit, splitFallback } from "./slot-fit";

type UseNeed = () => void;

/** A host value the frame sent, as a hook. */
function hostTableValue(pluginId: string, key: string, useNeed: UseNeed) {
  return (host: { id: string | number }) => {
    useNeed();
    const table = useFrameValue(pluginId, key) as
      Record<string, unknown> | undefined;
    return (table?.[String(host.id)] as never) ?? null;
  };
}

/**
 * A data slot row, as a hook: tells the frame the row is on screen (so its
 * hook runs for it) and reads the value the frame sent back.
 */
function rowTableValue(pluginId: string, key: string, useNeed: UseNeed) {
  return (context: Record<string, unknown>, rowKey: string) => {
    useNeed();
    let json = "";
    try {
      json = JSON.stringify(context);
    } catch {
      json = "";
    }
    useEffect(
      () => addDataRow(pluginId, key, rowKey, json ? JSON.parse(json) : {}),
      [rowKey, json],
    );
    const table = useFrameValue(pluginId, key) as
      Record<string, unknown> | undefined;
    return (table?.[rowKey] as never) ?? null;
  };
}

const START_TIMEOUT_MS = 20_000;
const MEMO_LIMIT = 500;
/** A background frame with no live value stops after this long unused. */
export const FRAME_IDLE_MS = 3 * 60_000;
const IDLE_CHECK_MS = 30_000;
/** Registrations a fresh frame did not report again by then are dropped. */
const STALE_GRACE_MS = 1_500;
/**
 * Redraws per registration per second. A caller that builds new arguments
 * every render (a fresh host object) would otherwise redraw forever.
 */
export const REFRESH_LIMIT = 20;

export interface FramedPlugin {
  handle: PluginAppHandle;
  dispose: () => void;
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

interface Registration {
  rid: string;
  kind: string;
  /** As the frame sent it, functions still references. */
  raw: unknown;
  data: Record<string, unknown>;
  dispose: () => void;
  memos: Map<string, (...args: unknown[]) => unknown>;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  refreshes: number[];
}

interface LiveFrame {
  iframe: HTMLIFrameElement;
  connection: FrameConnection | null;
  ready: boolean;
  /** Registrations this frame reported, in wire form. */
  raw: Map<string, unknown>;
}

function container(): HTMLElement {
  let node = document.getElementById("termix-plugin-frames");
  if (!node) {
    node = document.createElement("div");
    node.id = "termix-plugin-frames";
    document.body.appendChild(node);
  }
  return node;
}

const HIDDEN_STYLE =
  "position:fixed;left:0;top:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
const OVERLAY_STYLE =
  "position:fixed;inset:0;width:100vw;height:100vh;border:0;opacity:1;pointer-events:auto;z-index:60;background:transparent;color-scheme:normal;";

/**
 * A background frame covers the whole shell while it shows a dialog, so it
 * may only start doing that right after the user asked the plugin for
 * something: one of these registrations, run with a real click or key.
 */
const ASKING_KINDS = new Set([
  "action",
  "hostAction",
  "hostContextMenuItem",
  "hostEditorToolbarItem",
  "paletteEntry",
  "keybindingAction",
  "slotContribution",
  "railItem",
]);
export const OVERLAY_ASK_MS = 10_000;

function stableKey(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_key, value) =>
      typeof value === "function" ? undefined : value,
    );
  } catch {
    return String(Math.random());
  }
}

/** Same registration, apart from the function reference ids. */
function sameShape(a: unknown, b: unknown): boolean {
  try {
    const shape = (value: unknown) =>
      JSON.stringify(value, (_key, item) =>
        isWireFn(item) ? "\u0000fn" : item,
      );
    return shape(a) === shape(b);
  } catch {
    return false;
  }
}

/** Swaps each function reference for its path, so it survives a new frame. */
function markFunctions(value: unknown, path: string[] = []): unknown {
  if (value === null || typeof value !== "object") return value;
  if (isWireFn(value)) return { $fn: JSON.stringify(path) };
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      markFunctions(item, [...path, String(index)]),
    );
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = markFunctions(item, [...path, key]);
  }
  return out;
}

function atPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

let userKeyPromise: Promise<string | null> | null = null;

/**
 * Who the cache belongs to: the user and a hash of their grants, so a
 * grant change made anywhere starts from fresh answers.
 */
function currentUserKey(): Promise<string | null> {
  userKeyPromise ??= Promise.all([getUserInfo(), loadMyPermissions()])
    .then(([user, grants]) => {
      if (!user?.userId) return null;
      const text = JSON.stringify([
        grants.isAdmin,
        [...grants.permissions].sort(),
      ]);
      return `${user.userId}:${hashText(text)}`;
    })
    .catch(() => null);
  return userKeyPromise;
}

if (typeof window !== "undefined") {
  const forget = () => {
    userKeyPromise = null;
  };
  window.addEventListener("termix:logout", forget);
  window.addEventListener("permissionsChanged", forget);
}

const views = new Map<string, ComponentType<Record<string, unknown>>>();

/**
 * One component per plugin, key and fit, so re-registering never remounts.
 * A fit of `{ slot }` follows what that slot's owner declares.
 */
function framed(
  pluginId: string,
  ref: unknown,
  fit: FrameFit | { slot: string },
  adapt?: (props: Record<string, unknown>) => Record<string, unknown>,
  variant = "",
): ComponentType<Record<string, unknown>> | undefined {
  if (!isWireComponent(ref)) return undefined;
  const key = (ref as WireComponent).$component;
  const fitKey = typeof fit === "string" ? fit : `slot:${fit.slot}`;
  const id = `${pluginId}\u0000${key}\u0000${fitKey}\u0000${variant}`;
  let view = views.get(id);
  if (!view) {
    view =
      typeof fit === "string"
        ? function Framed(props: Record<string, unknown>) {
            return (
              <FramedView
                pluginId={pluginId}
                frameKey={key}
                how={fit}
                adapt={adapt}
                props={props}
              />
            );
          }
        : function Framed(props: Record<string, unknown>) {
            return (
              <SlotFramedView
                pluginId={pluginId}
                frameKey={key}
                slotId={fit.slot}
                adapt={adapt}
                props={props}
              />
            );
          };
    view.displayName = `Framed(${pluginId}:${key})`;
    setFrameMeta(view, { pluginId, frameKey: key, adapt });
    views.set(id, view);
  }
  return view;
}

/** Things a frame can't be handed: refs, DOM nodes, React children. */
function plainProps(props: Record<string, unknown>): Record<string, unknown> {
  const { handleRef, children, ...rest } = props;
  void handleRef;
  void children;
  return rest;
}

function companionProps(pluginId: string) {
  return (props: Record<string, unknown>) => {
    const { getHandle, ...rest } = plainProps(props);
    return {
      ...rest,
      // The frame turns this back into getHandle(), with async methods.
      handleCall: (method: unknown, ...args: unknown[]) => {
        if (!mayCallHandle(pluginId, method)) {
          throw new Error("Not allowed on this tab");
        }
        const handle = (getHandle as (() => unknown) | undefined)?.() as
          Record<string, unknown> | null | undefined;
        const fn = handle?.[method as string];
        return typeof fn === "function"
          ? (fn as (...a: unknown[]) => unknown).apply(handle, args)
          : undefined;
      },
    };
  };
}

/** A host editor section sends a patch function; it runs on the latest form. */
function hostSectionProps(props: Record<string, unknown>) {
  const rest = plainProps(props);
  const form = rest.form as Record<string, unknown> | undefined;
  const updateForm = rest.updateForm as
    | ((
        patch: (form: Record<string, unknown>) => Record<string, unknown>,
      ) => void)
    | undefined;
  return {
    ...rest,
    updateForm: async (patch: unknown) => {
      if (typeof patch !== "function" || !updateForm || !form) return;
      const next = (await (patch as AsyncFn)(form)) as Record<string, unknown>;
      if (!next || typeof next !== "object") return;
      const changed: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(next)) {
        if (form[name] !== value) changed[name] = value;
      }
      updateForm((latest) => ({ ...latest, ...changed }));
    },
  };
}

function manifestFor(summary: PluginSummary): PluginManifest {
  return {
    id: summary.id,
    name: summary.name,
    version: summary.version,
    description: "",
    author: { name: "" },
    license: "",
    category: "",
    engine: { termix: "", api: "2" },
    capabilities: summary.capabilities ?? [],
    dependencies: summary.dependencies,
    optionalDependencies: summary.optionalDependencies,
    contributes: summary.contributes as PluginManifest["contributes"],
    icon: summary.icon,
  };
}

/**
 * Starts a framed plugin. Resolves once its registrations are in place:
 * from the cache right away, else once the background frame finished
 * activate.
 */
export async function startFramedPlugin(
  summary: PluginSummary,
): Promise<FramedPlugin> {
  const pluginId = summary.id;
  const version = summary.assetVersion ?? "";
  const handle = createPluginApp(
    pluginId,
    manifestFor(summary),
    summary.contributes,
  );
  const app = handle.app as unknown as Record<
    string,
    (...args: unknown[]) => () => void
  >;
  const registrations = new Map<string, Registration>();

  let frame: LiveFrame | null = null;
  let starting: Promise<void> | null = null;
  let disposed = false;
  let userKey: string | null = null;
  /** Work the frame does by itself; any entry keeps it running. */
  let live: string[] = [];
  let needs = 0;
  let pending = 0;
  let overlay = false;
  /** When the user last asked this plugin for something. */
  let askedAt = 0;
  let lastUse = Date.now();
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  const answers: Record<string, unknown> = {};
  const values: Record<string, unknown> = {};

  // The shell's own tab and host objects never cross: a plain tab record
  // and the host as this plugin may see it.
  const plainHost = (host: unknown) =>
    host && typeof host === "object" && "id" in host
      ? toPluginHostRecord(
          host as Parameters<typeof toPluginHostRecord>[0],
          pluginId,
        )
      : host;
  const plainTab = (tab: unknown) => {
    if (!tab || typeof tab !== "object") return tab;
    const record = tab as Record<string, unknown>;
    return {
      id: record.id,
      instanceId: record.instanceId,
      type: record.type,
      label: record.label,
      hostId: (record.host as { id?: unknown } | undefined)?.id,
    };
  };
  const tabAndHost = (args: unknown[]) => [
    plainTab(args[0]),
    plainHost(args[1]),
  ];
  const hostFirst = (args: unknown[]) => [plainHost(args[0]), ...args.slice(1)];
  // A slot owner's context may carry a host with every plugin's settings.
  const scopedContext = (context: unknown) => {
    if (!context || typeof context !== "object") return context;
    const record = context as Record<string, unknown>;
    return "host" in record
      ? { ...record, host: plainHost(record.host) }
      : record;
  };

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const persist = () => {
    if (!userKey || disposed || persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeNow();
    }, 500);
  };
  const writeNow = () => {
    if (!userKey || disposed) return;
    writeCachedPlugin(userKey, pluginId, {
      version,
      live,
      registrations: [...registrations.values()].map((record) => ({
        rid: record.rid,
        kind: record.kind,
        raw: record.raw,
      })),
      answers: trimAnswers(answers),
      values: { ...values },
    });
  };

  const isLive = () => live.length > 0;

  const teardown = (current: LiveFrame) => {
    current.connection?.close();
    current.iframe.remove();
  };

  const stopFrame = () => {
    const current = frame;
    if (!current) return;
    frame = null;
    overlay = false;
    teardown(current);
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
  };

  const checkIdle = () => {
    if (!frame?.ready || isLive() || !userKey) return;
    if (needs > 0 || pending > 0 || overlay) return;
    if (Date.now() - lastUse < FRAME_IDLE_MS) return;
    stopFrame();
  };

  /** Starts the background frame if it is not running. */
  const ensureFrame = (): Promise<void> => {
    if (disposed) return Promise.reject(new Error("Plugin stopped"));
    if (frame?.ready) return Promise.resolve();
    if (starting) return starting;
    starting = new Promise<void>((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", SANDBOX);
      iframe.setAttribute("referrerpolicy", "no-referrer");
      iframe.setAttribute("allow", "clipboard-write");
      iframe.setAttribute("title", pluginId);
      iframe.setAttribute("aria-hidden", "true");
      iframe.dataset.pluginFrame = pluginId;
      iframe.dataset.frameRole = "background";
      iframe.setAttribute("style", HIDDEN_STYLE);
      const current: LiveFrame = {
        iframe,
        connection: null,
        ready: false,
        raw: new Map(),
      };
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        starting = null;
        if (error) {
          teardown(current);
          if (frame === current) frame = null;
          reject(error);
          return;
        }
        current.ready = true;
        lastUse = Date.now();
        resolve();
        if (!idleTimer) idleTimer = setInterval(checkIdle, IDLE_CHECK_MS);
        // Cached registrations the new frame no longer makes go away.
        setTimeout(() => {
          if (frame !== current || disposed) return;
          for (const rid of [...registrations.keys()]) {
            if (!current.raw.has(rid)) dropRecord(rid);
          }
          persist();
        }, STALE_GRACE_MS);
      };
      current.connection = connectFrame(
        iframe,
        pluginId,
        "background",
        undefined,
        {
          onReady: () => finish(),
          onFailed: (message) => finish(new Error(message)),
          onRaw: (name, data) => {
            if (name !== "register") return false;
            register(data, current);
            return true;
          },
          onEvent: (name, data) => {
            if (name === "unregister") {
              const rid = (data as { rid?: unknown } | null)?.rid;
              if (typeof rid === "string") {
                current.raw.delete(rid);
                dropRecord(rid);
                persist();
              }
            } else if (name === "value") {
              const entry = data as { key?: unknown; value?: unknown } | null;
              if (typeof entry?.key === "string") {
                setFrameValue(pluginId, entry.key, entry.value);
                if (isPlainValue(entry.value)) {
                  values[entry.key] = entry.value;
                } else {
                  delete values[entry.key];
                }
                persist();
              }
            } else if (name === "overlay") {
              const active =
                (data as { active?: unknown } | null)?.active === true;
              if (active && !overlay && Date.now() - askedAt > OVERLAY_ASK_MS) {
                if (import.meta.env.DEV) {
                  console.warn(
                    `[frame-policy] refused ${pluginId}: an overlay nobody asked for`,
                  );
                }
                return;
              }
              overlay = active;
              iframe.setAttribute(
                "style",
                overlay ? OVERLAY_STYLE : HIDDEN_STYLE,
              );
              if (overlay) iframe.focus();
              lastUse = Date.now();
            } else if (name === "live") {
              const reasons = (data as { reasons?: unknown } | null)?.reasons;
              const next = Array.isArray(reasons)
                ? reasons.filter((r): r is string => typeof r === "string")
                : [];
              if (hasOverlayPart()) next.push("overlay");
              live = [...new Set(next)].sort();
              persist();
            }
          },
        },
      );
      frame = current;
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              `activate() did not finish within ${START_TIMEOUT_MS / 1000}s`,
            ),
          ),
        START_TIMEOUT_MS,
      );
      iframe.src = frameUrl(pluginId, {
        role: "background",
        v: summary.assetVersion ?? undefined,
      });
      container().appendChild(iframe);
    });
    return starting;
  };

  /** Something needs the frame's live values while it is mounted. */
  const acquire = (): (() => void) => {
    needs++;
    lastUse = Date.now();
    void ensureFrame().catch(() => {});
    let released = false;
    return () => {
      if (released) return;
      released = true;
      needs--;
      lastUse = Date.now();
    };
  };
  const useNeed: UseNeed = () => {
    useEffect(() => acquire(), []);
  };

  /** Calls a function the frame registered, starting the frame first. */
  const callFn = async (
    rid: string,
    path: string,
    args: unknown[],
  ): Promise<unknown> => {
    pending++;
    lastUse = Date.now();
    const kind = registrations.get(rid)?.kind;
    if (kind && ASKING_KINDS.has(kind) && hasUserActivation()) {
      askedAt = Date.now();
    }
    try {
      await ensureFrame();
      const current = frame;
      const ref = current?.raw.has(rid)
        ? atPath(current.raw.get(rid), JSON.parse(path) as string[])
        : undefined;
      if (!current?.connection?.port || !isWireFn(ref)) {
        throw new Error("The plugin no longer has this function");
      }
      return await current.connection.port.importFn(ref)(...args);
    } finally {
      pending--;
      lastUse = Date.now();
    }
  };

  const decodeLazy = (rid: string, raw: unknown) =>
    decode(markFunctions(raw), {
      importFn:
        (ref) =>
        (...args: unknown[]) =>
          callFn(rid, ref.$fn, args),
      icon: (ref) => decodeIconValue(ref),
      component: (ref: WireComponent) => ref,
    }) as Record<string, unknown>;

  const memo = (
    record: Registration,
    field: string,
    fn: unknown,
    fallback: unknown,
    mapArgs: (args: unknown[]) => unknown[] = (args) => args,
  ): ((...args: unknown[]) => unknown) | undefined => {
    if (typeof fn !== "function") return undefined;
    const existing = record.memos.get(field);
    if (existing) return existing;
    const cache = new Map<string, unknown>();
    const inflight = new Set<string>();
    // Answers taken from the stored cache, not asked of a live frame yet.
    const stale = new Set<string>();
    const ask = (key: string, args: unknown[], stored: string) => {
      if (inflight.has(key)) return;
      inflight.add(key);
      (fn as AsyncFn)(...args)
        .then(
          (value) => {
            cache.set(key, value);
            if (isPlainValue(value)) answers[stored] = value;
            else delete answers[stored];
            persist();
          },
          () => {
            if (!cache.has(key)) cache.set(key, fallback);
          },
        )
        .finally(() => {
          inflight.delete(key);
          while (cache.size > MEMO_LIMIT) {
            cache.delete(cache.keys().next().value as string);
          }
          scheduleRefresh(record);
        });
    };
    const sync = (...raw: unknown[]) => {
      const args = mapArgs(raw);
      const key = stableKey(args);
      const stored = `${record.rid}\u0000${field}\u0000${key}`;
      if (stale.has(key) && frame?.ready) {
        stale.delete(key);
        ask(key, args, stored);
      }
      if (cache.has(key)) return cache.get(key);
      if (stored in answers) {
        cache.set(key, answers[stored]);
        if (frame?.ready) ask(key, args, stored);
        else stale.add(key);
        return answers[stored];
      }
      ask(key, args, stored);
      return fallback;
    };
    record.memos.set(field, sync);
    return sync;
  };

  const scheduleRefresh = (record: Registration) => {
    if (record.refreshTimer) return;
    const now = Date.now();
    record.refreshes = record.refreshes.filter((time) => now - time < 1000);
    if (record.refreshes.length >= REFRESH_LIMIT) {
      if (import.meta.env.DEV && record.refreshes.length === REFRESH_LIMIT) {
        console.warn(
          `[frame] ${pluginId}: ${record.kind} keeps getting new arguments, redraws paused`,
        );
      }
      record.refreshes.push(now);
      return;
    }
    record.refreshes.push(now);
    record.refreshTimer = setTimeout(() => {
      record.refreshTimer = null;
      if (![...registrations.values()].includes(record)) return;
      // Registering the same id again replaces it, so lists redraw with the
      // answers the frame just gave.
      record.dispose = replay(record);
    }, 30);
  };

  const fit = (
    ref: unknown,
    how: Parameters<typeof framed>[2],
    adapt?: Parameters<typeof framed>[3],
    variant?: string,
  ) => framed(pluginId, ref, how, adapt, variant);

  const replay = (record: Registration): (() => void) => {
    const data = record.data;
    const m = (
      field: string,
      fallback: unknown,
      mapArgs?: (args: unknown[]) => unknown[],
    ) => memo(record, field, data[field], fallback, mapArgs);
    switch (record.kind) {
      case "railItem":
        return app.registerRailItem({
          ...data,
          useBadge: data.badgeKey
            ? () => {
                useNeed();
                return useFrameValue(pluginId, String(data.badgeKey)) as
                  number | null;
              }
            : undefined,
          useStatus: data.statusKey
            ? () => {
                useNeed();
                return useFrameValue(pluginId, String(data.statusKey));
              }
            : undefined,
        });
      case "panel":
        return app.registerPanel(
          data.id,
          fit(data.component, "fill", plainProps),
          { keepMounted: data.keepMounted },
        );
      case "tab":
        return app.registerTab(
          data.id,
          fit(data.component, "fill", plainProps),
          {
            ...data,
            component: undefined,
            standalone: fit(data.standalone, "fill", plainProps),
            restore: m("restore", true, hostFirst),
            preload: undefined,
          },
        );
      case "companion":
        return app.registerCompanion(
          data.id,
          fit(data.component, "fill", companionProps(pluginId), "companion"),
          {
            ...data,
            component: undefined,
            when: m("when", false, tabAndHost),
            useDefaults: data.defaultsKey
              ? () => {
                  useNeed();
                  return (
                    (useFrameValue(pluginId, String(data.defaultsKey)) as
                      Record<string, unknown> | undefined) ?? {}
                  );
                }
              : undefined,
          },
        );
      case "companionLayout":
        return app.registerCompanionLayout(
          data.tabType,
          m("resolve", {}, hostFirst),
        );
      case "hostEditorSection":
        return app.registerHostEditorSection({
          ...data,
          visible: m("visible", true),
          component: fit(
            data.component,
            "content",
            hostSectionProps,
            "hostEditor",
          ),
        });
      case "hostAction":
        return app.registerHostAction({
          ...data,
          when: m("when", false),
          label: m("label", undefined),
          items: m("items", undefined),
        });
      case "hostProtocol":
        return app.registerHostProtocol({ ...data });
      case "hostBadge":
        return app.registerHostBadge({
          id: data.id,
          order: data.order,
          when: m("when", false),
          useDot: data.dotKey
            ? hostTableValue(pluginId, String(data.dotKey), useNeed)
            : undefined,
          useValue: data.valueKey
            ? hostTableValue(pluginId, String(data.valueKey), useNeed)
            : undefined,
        });
      case "hostStatusIndicator":
        return app.registerHostStatusIndicator({
          id: data.id,
          order: data.order,
          when: m("when", false),
          useValue: hostTableValue(pluginId, String(data.valueKey), useNeed),
        });
      case "hostEditorToolbarItem":
        return app.registerHostEditorToolbarItem({
          id: data.id,
          order: data.order,
          when: m("when", false),
          useValue: hostTableValue(pluginId, String(data.valueKey), useNeed),
        });
      case "hostSection":
        return app.registerHostSection({
          ...data,
          when: m("when", false),
          component: fit(data.component, "content", plainProps),
        });
      case "hostContextMenuItem":
        return app.registerHostContextMenuItem({
          ...data,
          when: m("when", false),
        });
      case "paletteEntry":
        return app.registerPaletteEntry({ ...data, when: m("when", false) });
      case "paletteGroup":
        return app.registerPaletteGroup({ ...data });
      case "keybindingAction":
        return app.registerKeybindingAction({
          ...data,
          editor: fit(data.editor, "content", plainProps),
          summary: fit(data.summary, "inline", plainProps),
          validate: m("validate", null),
        });
      case "keybindingDefault":
        return app.registerKeybindingDefault({ ...data });
      case "dashboardCard":
        return app.registerDashboardCard({
          ...data,
          component: fit(data.component, "fill", plainProps),
        });
      case "extension": {
        const { pointId, components, ...rest } = data as Record<
          string,
          unknown
        > & { components?: Record<string, unknown> };
        const parts = components
          ? Object.fromEntries(
              Object.entries(components).map(([name, ref]) => [
                name,
                fit(ref, extensionFit(name), plainProps),
              ]),
            )
          : undefined;
        return app.registerExtension(pointId, { ...rest, components: parts });
      }
      case "settingsComponent":
        return app.registerSettingsComponent(
          data.componentId,
          fit(data.component, "content", plainProps),
        );
      case "action":
        return app.registerAction(data.id, data.handler, {
          permission: data.permission,
        });
      case "actionSlot":
        return app.declareActionSlot({ ...data });
      case "slotContribution": {
        const { slotId, component, valueKey, ...rest } = data;
        // Overlays draw inside the background frame, next to the code that
        // fills them.
        if (slotId === "shell.overlay") return () => {};
        return app.registerSlotContribution(slotId, {
          ...rest,
          component: component
            ? fit(component, { slot: String(slotId) }, plainProps)
            : undefined,
          useValue: valueKey
            ? rowTableValue(pluginId, String(valueKey), useNeed)
            : undefined,
          when: m("when", false, (args) => [scopedContext(args[0])]),
        });
      }
      case "onboardingStep":
        return app.registerOnboardingStep({
          ...data,
          component: fit(data.component, "fill", plainProps),
          when: m("when", false),
        });
      case "component":
        return app.registerComponent(
          data.id,
          fit(data.component, "content", plainProps),
        );
      case "loginEnrollment":
        return app.registerLoginMethod({
          id: data.id,
          titleKey: data.titleKey,
          enrollment: fit(data.enrollment, "content", plainProps),
        } as never);
      case "factorEnrollment":
        return app.registerSecondFactorUI({
          id: data.id,
          titleKey: data.titleKey,
          enrollment: fit(data.enrollment, "content", plainProps),
        } as never);
      case "sshAuthEditor":
        return app.registerSshAuthEditor({
          ...data,
          component: fit(data.component, "content", plainProps),
        });
      default:
        console.warn(
          `[plugins] ${pluginId}: unknown registration ${record.kind}`,
        );
        return () => {};
    }
  };

  const hasOverlayPart = () =>
    [...registrations.values()].some(
      (record) =>
        record.kind === "slotContribution" &&
        record.data.slotId === "shell.overlay",
    );

  /** A registration from the live frame (source) or from the cache. */
  const register = (payload: unknown, source: LiveFrame | null) => {
    const entry = payload as {
      rid?: unknown;
      kind?: unknown;
      data?: unknown;
    } | null;
    if (
      typeof entry?.rid !== "string" ||
      typeof entry.kind !== "string" ||
      !entry.data ||
      typeof entry.data !== "object"
    ) {
      return;
    }
    const rid = entry.rid;
    if (source) source.raw.set(rid, entry.data);
    const existing = registrations.get(rid);
    if (existing) {
      if (existing.kind === entry.kind && sameShape(existing.raw, entry.data)) {
        // Same as cached: its functions now reach this frame, no redraw.
        existing.raw = entry.data;
        return;
      }
      if (!source) return;
      dropRecord(rid);
    }
    const record: Registration = {
      rid,
      kind: entry.kind,
      raw: entry.data,
      data: decodeLazy(rid, entry.data),
      dispose: () => {},
      memos: new Map(),
      refreshTimer: null,
      refreshes: [],
    };
    try {
      record.dispose = replay(record);
      registrations.set(rid, record);
    } catch (error) {
      console.error(`[plugins] ${pluginId}: ${entry.kind} was refused`, error);
      return;
    }
    if (source) persist();
  };

  const dropRecord = (rid: string) => {
    const record = registrations.get(rid);
    if (!record) return;
    registrations.delete(rid);
    if (record.refreshTimer) clearTimeout(record.refreshTimer);
    try {
      record.dispose();
    } catch {
      // Already gone.
    }
  };

  // Settings may change what the plugin registers: let it look again.
  const onSettings = (event: Event) => {
    const detail = (event as CustomEvent).detail as { pluginId?: string };
    if (detail?.pluginId !== pluginId || frame || disposed) return;
    lastUse = Date.now();
    void ensureFrame().catch(() => {});
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (persistTimer) clearTimeout(persistTimer);
    window.removeEventListener("termix:plugin-settings-changed", onSettings);
    setFrameDemand(pluginId, null);
    stopFrame();
    for (const record of registrations.values()) {
      if (record.refreshTimer) clearTimeout(record.refreshTimer);
    }
    registrations.clear();
    handle.dispose();
    clearFrameValues(pluginId);
  };

  userKey = await currentUserKey();
  const cached = userKey
    ? await readCachedPlugin(userKey, pluginId, version)
    : null;

  window.addEventListener("termix:plugin-settings-changed", onSettings);
  setFrameDemand(pluginId, acquire);

  if (cached && cached.live.length === 0) {
    Object.assign(answers, cached.answers);
    Object.assign(values, cached.values);
    for (const [key, value] of Object.entries(values)) {
      setFrameValue(pluginId, key, value);
    }
    for (const entry of cached.registrations) {
      register({ rid: entry.rid, kind: entry.kind, data: entry.raw }, null);
    }
    return { handle, dispose };
  }

  try {
    await ensureFrame();
  } catch (error) {
    dispose();
    throw error;
  }
  return { handle, dispose };
}
