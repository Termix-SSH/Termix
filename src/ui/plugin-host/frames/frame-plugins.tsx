/**
 * Runs a framed plugin's frontend.
 *
 * Its activate runs in a hidden background frame, which reports each
 * registration as data. Here every registration is replayed into the same
 * app object an in-page plugin gets (so ids, keys, permissions and host
 * scoping work the same), with components swapped for frame views,
 * functions for calls into the frame, and hooks for values the frame sends.
 */

import type { ComponentType } from "react";
import type { PluginSummary } from "@/api/plugins-api";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/frontend";
import { isWireComponent, type WireComponent } from "@/plugin-frame/protocol";
import { createPluginApp, type PluginAppHandle } from "../app";
import { connectFrame, frameUrl, mayCallHandle } from "./frame-connection";
import { PluginFrameView, SANDBOX, type FrameFit } from "./PluginFrameView";
import { clearFrameValues, setFrameValue, useFrameValue } from "./frame-values";
import { toPluginHostRecord } from "../bridge";

const START_TIMEOUT_MS = 20_000;
const MEMO_LIMIT = 500;

export interface FramedPlugin {
  handle: PluginAppHandle;
  dispose: () => void;
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

interface Registration {
  kind: string;
  data: Record<string, unknown>;
  dispose: () => void;
  memos: Map<string, (...args: unknown[]) => unknown>;
  refreshTimer: ReturnType<typeof setTimeout> | null;
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

function stableKey(args: unknown[]): string {
  try {
    return JSON.stringify(args, (_key, value) =>
      typeof value === "function" ? undefined : value,
    );
  } catch {
    return String(Math.random());
  }
}

/** Which way a component fills its place, by kind and slot. */
/** A toolbar slot takes a button, a tabs slot a whole page, anything else a block. */
function slotFit(slotId: string): FrameFit {
  if (/toolbar/i.test(slotId)) return "inline";
  if (/tabs?$/i.test(slotId)) return "fill";
  return "content";
}

function extensionFit(name: string): FrameFit {
  return /form|editor|settings/i.test(name) ? "content" : "fill";
}

const views = new Map<string, ComponentType<Record<string, unknown>>>();

/** One component per plugin, key and fit, so re-registering never remounts. */
function framed(
  pluginId: string,
  ref: unknown,
  fit: FrameFit,
  adapt?: (props: Record<string, unknown>) => Record<string, unknown>,
  variant = "",
): ComponentType<Record<string, unknown>> | undefined {
  if (!isWireComponent(ref)) return undefined;
  const key = (ref as WireComponent).$component;
  const id = `${pluginId}\u0000${key}\u0000${fit}\u0000${variant}`;
  let view = views.get(id);
  if (!view) {
    view = function FramedView(props: Record<string, unknown>) {
      return (
        <PluginFrameView
          pluginId={pluginId}
          frameKey={key}
          fit={fit}
          props={adapt ? adapt(props) : props}
        />
      );
    };
    view.displayName = `Framed(${pluginId}:${key})`;
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

/** Starts a plugin's background frame and resolves once activate finished. */
export function startFramedPlugin(
  summary: PluginSummary,
): Promise<FramedPlugin> {
  const pluginId = summary.id;
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

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", SANDBOX);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("title", pluginId);
  iframe.setAttribute("aria-hidden", "true");
  iframe.dataset.pluginFrame = pluginId;
  iframe.dataset.frameRole = "background";
  iframe.setAttribute("style", HIDDEN_STYLE);

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
    const sync = (...raw: unknown[]) => {
      const args = mapArgs(raw);
      const key = stableKey(args);
      if (cache.has(key)) return cache.get(key);
      if (!inflight.has(key)) {
        inflight.add(key);
        (fn as AsyncFn)(...args)
          .then(
            (value) => cache.set(key, value),
            () => cache.set(key, fallback),
          )
          .finally(() => {
            inflight.delete(key);
            while (cache.size > MEMO_LIMIT) {
              cache.delete(cache.keys().next().value as string);
            }
            scheduleRefresh(record);
          });
      }
      return fallback;
    };
    record.memos.set(field, sync);
    return sync;
  };

  const scheduleRefresh = (record: Registration) => {
    if (record.refreshTimer) return;
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
    how: FrameFit,
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
            ? () =>
                useFrameValue(pluginId, String(data.badgeKey)) as number | null
            : undefined,
          useStatus: data.statusKey
            ? () => useFrameValue(pluginId, String(data.statusKey))
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
              ? () =>
                  (useFrameValue(pluginId, String(data.defaultsKey)) as
                    Record<string, unknown> | undefined) ?? {}
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
            ? (host: { id: string | number }) => {
                const table = useFrameValue(pluginId, String(data.dotKey)) as
                  Record<string, unknown> | undefined;
                return (table?.[String(host.id)] as never) ?? null;
              }
            : undefined,
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
        const { slotId, component, ...rest } = data;
        // Overlays draw inside the background frame, next to the code that
        // fills them.
        if (slotId === "shell.overlay") return () => {};
        return app.registerSlotContribution(slotId, {
          ...rest,
          component: fit(component, slotFit(String(slotId)), plainProps),
          when: m("when", false),
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

  const register = (payload: unknown) => {
    const entry = payload as {
      rid?: unknown;
      kind?: unknown;
      data?: unknown;
    } | null;
    if (
      typeof entry?.rid !== "string" ||
      typeof entry.kind !== "string" ||
      !entry.data ||
      typeof entry.data !== "object" ||
      registrations.has(entry.rid)
    ) {
      return;
    }
    const record: Registration = {
      kind: entry.kind,
      data: entry.data as Record<string, unknown>,
      dispose: () => {},
      memos: new Map(),
      refreshTimer: null,
    };
    try {
      record.dispose = replay(record);
      registrations.set(entry.rid, record);
    } catch (error) {
      console.error(`[plugins] ${pluginId}: ${entry.kind} was refused`, error);
    }
  };

  const unregister = (payload: unknown) => {
    const rid = (payload as { rid?: unknown } | null)?.rid;
    if (typeof rid !== "string") return;
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

  const setOverlay = (active: boolean) => {
    iframe.setAttribute("style", active ? OVERLAY_STYLE : HIDDEN_STYLE);
    if (active) iframe.focus();
  };

  return new Promise<FramedPlugin>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        dispose();
        reject(error);
      } else {
        resolve({ handle, dispose });
      }
    };
    const connection = connectFrame(iframe, pluginId, "background", undefined, {
      onReady: () => finish(),
      onFailed: (message) => finish(new Error(message)),
      onEvent: (name, data) => {
        if (name === "register") register(data);
        else if (name === "unregister") unregister(data);
        else if (name === "value") {
          const entry = data as { key?: unknown; value?: unknown } | null;
          if (typeof entry?.key === "string") {
            setFrameValue(pluginId, entry.key, entry.value);
          }
        } else if (name === "overlay") {
          setOverlay((data as { active?: unknown } | null)?.active === true);
        }
      },
    });
    const dispose = () => {
      connection.close();
      iframe.remove();
      for (const record of registrations.values()) {
        if (record.refreshTimer) clearTimeout(record.refreshTimer);
      }
      registrations.clear();
      handle.dispose();
      clearFrameValues(pluginId);
    };
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
}
