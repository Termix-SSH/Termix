import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Puzzle } from "lucide-react";
import {
  invokeAction,
  useHost,
  type PluginHostRecord,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  scopeHost,
  scopeHostArgs,
  scopeHostFields,
} from "@/plugin-host/host-scope";
import { setShellHosts, withShellHost } from "@/plugin-host/shell-bridge";
import { resetActionRegistry } from "@/shell/action-registry";
import { resetHostContributions } from "@/sidebar/host-contributions";
import { resetPanels } from "@/shell/panel-registry";
import { resetTabTypes } from "@/shell/tab-registry";
import { resetRegisteredRailItems } from "@/sidebar/rail-items";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import type { Host } from "@/types/ui-types";

const SETTINGS = {
  fixture: { enableFixture: true },
  other: { secretKnob: "hands off" },
};

const saved = {
  id: "7",
  name: "web-01",
  ip: "10.0.0.7",
  port: 22,
  pluginSettings: SETTINGS,
} as unknown as Host;

afterEach(() => {
  setShellHosts([]);
});

describe("scopeHost", () => {
  it("keeps only the plugin's own settings", () => {
    const scoped = scopeHost(saved, "fixture");
    expect(scoped.pluginSettings).toEqual({ fixture: SETTINGS.fixture });
    expect(scoped.name).toBe("web-01");
    expect(saved.pluginSettings).toEqual(SETTINGS);
  });

  it("gives a plugin with no settings on the host an empty bag", () => {
    expect(scopeHost(saved, "nobody").pluginSettings).toEqual({});
  });

  it("re-reads a host another plugin handed over from the shell's copy", () => {
    setShellHosts([saved]);
    const fromOther = scopeHost({ ...saved }, "other");
    expect(fromOther.pluginSettings).toEqual({ other: SETTINGS.other });
    expect(scopeHost(fromOther, "fixture").pluginSettings).toEqual({
      fixture: SETTINGS.fixture,
    });
  });

  it("returns the same object for the same host, so effects stay put", () => {
    expect(scopeHost(saved, "fixture")).toBe(scopeHost(saved, "fixture"));
    expect(scopeHost(saved, "fixture")).not.toBe(scopeHost(saved, "other"));
  });

  it("passes anything that is not a host through untouched", () => {
    const shellApi = { openTab: () => {} };
    expect(scopeHost(shellApi, "fixture")).toBe(shellApi);
    expect(scopeHost("7", "fixture")).toBe("7");
    expect(scopeHost(null, "fixture")).toBeNull();
    const list = [saved];
    expect(scopeHostFields(list, "fixture")).toBe(list);
  });

  it("scopes host fields of props and request objects", () => {
    const props = { host: saved, sshHost: saved, hostConfig: saved, n: 1 };
    const scoped = scopeHostFields(props, "fixture");
    expect(scoped.host.pluginSettings).toEqual({ fixture: SETTINGS.fixture });
    expect(scoped.sshHost.pluginSettings).toEqual({
      fixture: SETTINGS.fixture,
    });
    expect(scoped.hostConfig.pluginSettings).toEqual({
      fixture: SETTINGS.fixture,
    });
    expect(scoped.n).toBe(1);
    const noHost = { appTheme: "dark" };
    expect(scopeHostFields(noHost, "fixture")).toBe(noHost);
    const [request] = scopeHostArgs([{ host: saved, appTheme: "dark" }], "x");
    expect((request as { host: Host }).host.pluginSettings).toEqual({});
  });

  it("lets a tab opened from a plugin's host keep every plugin's settings", () => {
    setShellHosts([saved]);
    const merged = withShellHost(scopeHost(saved, "other"));
    expect(merged?.pluginSettings).toEqual(SETTINGS);
  });
});

const MANIFEST: Partial<PluginManifest> = {
  id: "fixture",
  name: "Fixture",
  contributes: {
    tabs: [
      { id: "fixture-tab", titleKey: "title", icon: "Puzzle", openFrom: [] },
    ],
    panels: [{ id: "fixture-panel", titleKey: "title" }],
  },
};

let seen: Record<string, unknown> = {};

function HostProbe() {
  const host = useHost("7");
  return <span>{JSON.stringify(host?.pluginSettings ?? null)}</span>;
}

function activate(app: TermixApp) {
  app.registerPanel("fixture-panel", HostProbe);
  app.registerTab("fixture-tab", ({ host }) => (
    <span>{JSON.stringify(host?.pluginSettings ?? null)}</span>
  ));
  app.registerHostAction({
    id: "fixture-open",
    titleKey: "title",
    icon: Puzzle,
    kind: "open",
    when: (host) => {
      seen.when = host.pluginSettings;
      return true;
    },
  });
  app.registerAction("fixture.inspect", ((
    host: PluginHostRecord,
    request: { host: PluginHostRecord },
  ) => {
    seen.action = host.pluginSettings;
    seen.request = request.host.pluginSettings;
  }) as never);
}

let rendered: RenderedPluginApp | null = null;

async function mount() {
  rendered = await renderWithApp(
    { activate },
    {
      manifest: MANIFEST,
      locales: { title: "Fixture" },
      hosts: [saved as unknown as Record<string, unknown>],
    },
  );
  return rendered;
}

describe("host settings a plugin sees", () => {
  afterEach(async () => {
    await rendered?.deactivate();
    rendered = null;
    seen = {};
    resetActionRegistry();
    resetHostContributions();
    resetPanels();
    resetTabTypes();
    resetRegisteredRailItems();
    resetPluginStore();
  });

  const own = JSON.stringify({ fixture: SETTINGS.fixture });

  it("useHost carries only the plugin's own settings", async () => {
    const app = await mount();
    app.renderPanel("fixture-panel");
    expect(await screen.findByText(own)).toBeTruthy();
  });

  it("a tab's host prop carries only the plugin's own settings", async () => {
    const app = await mount();
    app.renderTab("fixture-tab", { host: saved });
    expect(await screen.findByText(own)).toBeTruthy();
  });

  it("app.getHost is scoped too", async () => {
    const { app } = await mount();
    expect(app.getHost(7)?.pluginSettings).toEqual({
      fixture: SETTINGS.fixture,
    });
    expect(app.getHost(99)).toBeUndefined();
  });

  it("host action callbacks get the plugin's slice", async () => {
    const app = await mount();
    app.registered.hostActionsFor(saved);
    expect(seen.when).toEqual({ fixture: SETTINGS.fixture });
  });

  it("an action handler gets a host another plugin passed, re-read for it", async () => {
    await mount();
    const fromOther = scopeHost(saved, "other");
    await invokeAction("fixture.inspect", fromOther, { host: fromOther });
    expect(seen.action).toEqual({ fixture: SETTINGS.fixture });
    expect(seen.request).toEqual({ fixture: SETTINGS.fixture });
  });
});
