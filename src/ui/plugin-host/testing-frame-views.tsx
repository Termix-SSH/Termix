/**
 * Renders every view a plugin registers, with the mock shell, while every
 * request those views make goes through the same check a plugin frame's
 * requests get. A core request the frame policy refuses would fail in
 * Termix, so a plugin's own test can catch it before release.
 */

import type { ComponentType, ReactElement } from "react";
import { act, render } from "@testing-library/react";
import type {
  FrontendPluginModule,
  RenderWithAppOptions,
} from "@termix-ssh/plugin-sdk/testing";
import { ThemeProvider } from "@/components/theme-provider";
import { SurfaceScope } from "@/components/surface/surface-scope";
import { createFrameXhr } from "@/plugin-frame/net";
import { checkCoreRequest } from "./frames/frame-policy";
import { getTabType, listTabTypes } from "@/shell/tab-registry";
import { getPanel, listPanels } from "@/shell/panel-registry";
import {
  getHostEditorSection,
  hostEditorSectionList,
} from "@/sidebar/HostManagerTabs";
import {
  getRegisteredDashboardCard,
  registeredDashboardCardList,
} from "@/dashboard/dashboard-cards-registry";
import {
  getSettingsComponent,
  listSettingsComponents,
} from "@/settings/settings-components";
import { getSlotContributions } from "@/shell/action-registry";
import { listCompanionDefs } from "@/shell/companions";
import { listHostSections } from "@/shell/host-sections";
import { listExtensions } from "./extension-registry";
import { getPluginComponent } from "./component-registry";
import { onboardingSteps } from "@/onboarding/onboarding-registry";
import type { Host, Tab } from "@/types/ui-types";

export interface FrameViewsOptions extends Pick<
  RenderWithAppOptions,
  "hosts" | "permissions" | "isAdmin" | "locales"
> {
  manifest: Record<string, unknown>;
  /**
   * Answers a request: the plugin's own routes and allowed core reads.
   * Returns the JSON body. Defaults to an empty object.
   */
  respond?: (method: string, path: string) => unknown;
  /** How long each view gets to send its first requests. Default 50 ms. */
  settleMs?: number;
}

export interface FrameViewsResult {
  /** Each view rendered, like "tab:alerts.main". */
  rendered: string[];
  /** Core requests the frame policy refused, like "GET /users/list". */
  refused: string[];
  /** Views that threw while rendering. Not a frame problem by itself. */
  errors: string[];
}

const API_PREFIX = /^\/__termix_api\/\d+/;

function pathOf(url: string): { path: string; query: string } {
  const parsed = new URL(url, "http://termix.test/");
  return {
    path: parsed.pathname.replace(API_PREFIX, "") || "/",
    query: parsed.search,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Where a request a view sends would go from a frame, and its answer. */
export function frameRoute(
  pluginId: string,
  method: string,
  url: string,
): { kind: "own" | "core" | "refused"; path: string } {
  const { path, query } = pathOf(url);
  const own = new RegExp(
    `^/plugin-(api|assets|ws)/${pluginId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`,
  );
  if (own.test(path)) return { kind: "own", path };
  const check = checkCoreRequest(pluginId, method, `${path}${query}`);
  return { kind: check.ok ? "core" : "refused", path };
}

/**
 * `points` lists the slots, extension points and shared component ids the
 * plugin registered into, as [kind, id] pairs.
 */
export async function renderFrameViews(
  plugin: FrontendPluginModule,
  render_: (
    plugin: FrontendPluginModule,
    options: RenderWithAppOptions,
  ) => Promise<{ deactivate: () => Promise<void> }>,
  points: Array<[string, string]>,
  options: FrameViewsOptions,
): Promise<FrameViewsResult> {
  const pluginId = String(options.manifest.id ?? "test-plugin");
  const refused = new Set<string>();
  const errors: string[] = [];
  const rendered: string[] = [];
  const respond = options.respond ?? (() => ({}));
  const settleMs = options.settleMs ?? 50;

  const realFetch = globalThis.fetch;
  const realXhr = globalThis.XMLHttpRequest;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = String(
      init?.method ?? (input instanceof Request ? input.method : "GET"),
    ).toUpperCase();
    const route = frameRoute(pluginId, method, url);
    if (route.kind === "refused") {
      refused.add(`${method} ${route.path}`);
      return json(403, { error: "Not available to plugin views" });
    }
    return json(200, respond(method, route.path));
  }) as typeof fetch;
  globalThis.fetch = fakeFetch;
  globalThis.XMLHttpRequest = createFrameXhr(fakeFetch) as never;

  const hosts = (options.hosts ?? []) as unknown as Host[];
  const host = hosts[0];
  const tab = (type: string): Tab => ({
    id: `${type}-test`,
    instanceId: `${type}-test`,
    type,
    label: type,
    host,
    openedAt: 0,
  });
  const noop = () => {};
  const mine = <T extends { pluginId?: string }>(items: T[]) =>
    items.filter((item) => item.pluginId === pluginId);

  let app: { deactivate: () => Promise<void> } | null = null;
  try {
    app = await render_(plugin, {
      manifest: options.manifest as RenderWithAppOptions["manifest"],
      hosts: options.hosts,
      permissions: options.permissions,
      isAdmin: options.isAdmin ?? true,
      locales: options.locales,
    });

    const views: Array<[string, () => ReactElement]> = [];
    const add = (
      name: string,
      Component: ComponentType<Record<string, unknown>> | undefined,
      props: Record<string, unknown> = {},
    ) => {
      if (Component) views.push([name, () => <Component {...props} />]);
    };
    const hostProps = host
      ? { host, hostId: Number(host.id), online: true }
      : {};

    for (const def of mine(listTabTypes())) {
      add(`tab:${def.id}`, getTabType(def.id)?.component as never, {
        tab: tab(def.id),
        host,
        label: def.id,
        isVisible: true,
        isFocusedPane: true,
        inSplit: false,
        handleRef: null,
      });
    }
    for (const panel of mine(listPanels())) {
      add(`panel:${panel.id}`, getPanel(panel.id)?.component as never, {
        active: true,
        setEditing: noop,
        placement: "left",
      });
    }
    for (const card of mine(registeredDashboardCardList())) {
      add(
        `card:${card.id}`,
        getRegisteredDashboardCard(card.id)?.component as never,
        { isVisible: true },
      );
    }
    for (const section of mine(hostEditorSectionList())) {
      add(
        `hostEditor:${section.id}`,
        getHostEditorSection(section.id)?.component as never,
        {
          form: {},
          setField: noop,
          updateForm: noop,
          protocols: {},
          hostId: host ? Number(host.id) : undefined,
        },
      );
    }
    for (const key of listSettingsComponents()) {
      if (!key.startsWith(`${pluginId}:`)) continue;
      const id = key.slice(pluginId.length + 1);
      add(`settings:${id}`, getSettingsComponent(pluginId, id) as never, {
        pluginId,
        values: {},
        setValue: noop,
        running: true,
      });
    }
    for (const companion of mine(listCompanionDefs())) {
      add(`companion:${companion.id}`, companion.component as never, {
        tab: tab("terminal"),
        host,
        getHandle: () => null,
        side: "right",
        isVisible: true,
        close: noop,
        setSide: noop,
      });
    }
    for (const section of mine(listHostSections())) {
      add(`hostSection:${section.id}`, section.component as never, hostProps);
    }
    for (const step of onboardingSteps.list()) {
      if (!step.id.startsWith(`${pluginId}:`)) continue;
      add(`onboarding:${step.id}`, step.Component as never, {
        mode: "full",
        isAdmin: true,
        isDesktop: false,
        shellReady: false,
        setCanContinue: noop,
        setBeforeNext: noop,
      });
    }
    // Slots, extension points and shared components: found through the
    // registrations, since those registries are keyed by point.
    const seenSlots = new Set<string>();
    const seenPoints = new Set<string>();
    for (const [kind, id] of points) {
      if (kind === "slot" && !seenSlots.has(id)) {
        seenSlots.add(id);
        for (const entry of getSlotContributions(id)) {
          if (entry.pluginId !== pluginId || !entry.component) continue;
          add(`slot:${id}:${entry.actionId}`, entry.component, hostProps);
        }
      } else if (kind === "extension" && !seenPoints.has(id)) {
        seenPoints.add(id);
        for (const entry of listExtensions(id)) {
          if (entry.pluginId !== pluginId) continue;
          const parts = (entry.components ?? {}) as Record<
            string,
            ComponentType<Record<string, unknown>>
          >;
          for (const [part, Component] of Object.entries(parts)) {
            add(`extension:${id}:${entry.id}:${part}`, Component, {
              ...hostProps,
              config: {},
              onConfigChange: noop,
            });
          }
        }
      } else if (kind === "component") {
        add(`component:${id}`, getPluginComponent(id), hostProps);
      }
    }

    for (const [name, element] of views) {
      try {
        const view = render(
          <ThemeProvider defaultTheme="dark" storageKey="termix-test-theme">
            <SurfaceScope className="h-full">{element()}</SurfaceScope>
          </ThemeProvider>,
        );
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, settleMs));
        });
        view.unmount();
        rendered.push(name);
      } catch (error) {
        errors.push(
          `${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    try {
      await app?.deactivate();
    } finally {
      globalThis.fetch = realFetch;
      globalThis.XMLHttpRequest = realXhr;
    }
  }
  return { rendered, refused: [...refused].sort(), errors };
}
