import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Puzzle } from "lucide-react";
import {
  homepageWidgetType,
  useActivityTypes,
  useHomepageWidgetTypes,
  useHostActions,
  usePermission,
  useTranslation,
  type TermixApp,
} from "@termix/plugin-sdk/frontend";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { NavigationVisibilityToggles } from "@/sidebar/NavigationVisibilityToggles";
import {
  hostActionsFor,
  listHostActions,
  defaultConnectAction,
  resetHostContributions,
} from "@/sidebar/host-contributions";
import { resolveHostTabType } from "@/lib/host-connection-tabs";
import {
  makeHostSshSubTabs,
  makeHostTabs,
  resetHostEditorSections,
} from "@/sidebar/HostManagerTabs";
import {
  listPaletteEntries,
  paletteEntriesFor,
  resetPaletteEntries,
} from "@/shell/palette-registry";
import { shell } from "@/plugin-host/shell-bridge";
import { resetRegisteredRailItems } from "@/sidebar/rail-items";
import { resetTabTypes } from "@/shell/tab-registry";
import { resetPanels } from "@/shell/panel-registry";
import { resetDashboardCards } from "@/dashboard/dashboard-cards-registry";
import { resetHomepageWidgetTypes } from "@/plugin-host/homepage-widget-registry";
import { resetSettingsComponents } from "@/settings/settings-components";
import { resetActionRegistry } from "@/shell/action-registry";
import { resetPluginStore } from "@/plugin-host/plugin-store";
import { SettingsFieldRow } from "@/settings/SettingsFields";
import type { Host } from "@/types/ui-types";

const MANIFEST: Partial<PluginManifest> = {
  id: "fixture",
  name: "Fixture",
  contributes: {
    tabs: [
      {
        id: "fixture-tab",
        titleKey: "title",
        icon: "Puzzle",
        openFrom: ["rail"],
      },
    ],
    panels: [{ id: "fixture-panel", titleKey: "title" }],
    dashboardCards: [{ id: "fixture-card", titleKey: "title" }],
    permissions: [{ name: "use", titleKey: "title", descriptionKey: "title" }],
  },
};

const LOCALES = { title: "Fixture title", greeting: "Hello from fixture" };

function Counter() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {t("greeting")} {count}
    </button>
  );
}

function PermissionProbe() {
  return <span>{usePermission("use") ? "allowed" : "denied"}</span>;
}

function activate(app: TermixApp) {
  app.registerRailItem({
    id: "fixture-panel",
    icon: Puzzle,
    titleKey: "title",
  });
  app.registerPanel("fixture-panel", () => <Counter />);
  app.registerTab(
    "fixture-tab",
    ({ host }) => <span>tab for {host?.name ?? "nobody"}</span>,
    { activityTypes: ["fixture_activity"] },
  );
  app.registerHostEditorSection({
    id: "fixture-section",
    group: "ssh",
    titleKey: "title",
    order: 15,
    component: ({ setField }) => (
      <button type="button" onClick={() => setField("fixture", true)}>
        section
      </button>
    ),
  });
  app.registerHostAction({
    id: "fixture-connect",
    titleKey: "title",
    icon: Puzzle,
    kind: "connect",
    priority: 500,
    tabType: "fixture-tab",
    when: (host) => host.enableFixture === true,
  });
  app.registerPaletteEntry({
    id: "fixture-entry",
    titleKey: "title",
    scope: "host",
    when: (host) => host?.enableFixture === true,
    run: (shell, host) => shell.openTab(host ?? null, "fixture-tab"),
  });
  app.registerDashboardCard({
    id: "fixture-card",
    titleKey: "title",
    component: ({ shell }) => (
      <button
        type="button"
        onClick={() => shell.openSingletonTab("fixture-tab")}
      >
        card
      </button>
    ),
  });
  app.registerSettingsComponent("probe", PermissionProbe);
  app.registerHomepageWidget({
    id: "fixture-widget",
    name: "Fixture Widget",
    description: "A fixture widget",
    category: "info",
    icon: <Puzzle size={14} />,
    defaultConfig: {},
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 2, h: 2 },
    component: () => <span>fixture widget</span>,
  });
}

let rendered: RenderedPluginApp | null = null;

async function mount(permissions: string[] = []) {
  rendered = await renderWithApp(
    { activate },
    { manifest: MANIFEST, locales: LOCALES, permissions },
  );
  return rendered;
}

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
  resetRegisteredRailItems();
  resetTabTypes();
  resetPanels();
  resetDashboardCards();
  resetSettingsComponents();
  resetActionRegistry();
  resetHostContributions();
  resetHostEditorSections();
  resetPaletteEntries();
  resetPluginStore();
  resetHomepageWidgetTypes();
});

const host = (overrides: Partial<Host> = {}) =>
  ({ id: "1", name: "web-01", ip: "10.0.0.1", port: 22, ...overrides }) as Host;

describe("registries through the app object", () => {
  it("records everything the plugin registered", async () => {
    const app = await mount();
    expect(app.registered.railItems()).toEqual([
      { id: "fixture-panel", hidden: undefined },
    ]);
    expect(app.registered.tabs()).toEqual(["fixture-tab"]);
    expect(app.registered.panels()).toEqual(["fixture-panel"]);
    expect(app.registered.hostEditorSections()).toEqual(["fixture-section"]);
    expect(app.registered.hostActions()).toEqual([
      { id: "fixture-connect", tabType: "fixture-tab" },
    ]);
    expect(app.registered.dashboardCards()).toEqual(["fixture-card"]);
    expect(app.registered.settingsComponents()).toEqual(["probe"]);
  });

  it("removes every registration on deactivate", async () => {
    const app = await mount();
    await app.deactivate();
    expect(app.registered.railItems()).toEqual([]);
    expect(app.registered.tabs()).toEqual([]);
    expect(app.registered.hostActions()).toEqual([]);
    expect(app.registered.dashboardCards()).toEqual([]);
    rendered = null;
  });

  it("renders a panel with hooks bound to the plugin", async () => {
    const app = await mount();
    const container = app.renderPanel("fixture-panel");
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("Hello from fixture 0");
    fireEvent.click(button);
    expect(button.textContent).toBe("Hello from fixture 1");
  });

  it("renders a tab with the generic tab props", async () => {
    const app = await mount();
    const container = app.renderTab("fixture-tab", { host: host() });
    expect(container.textContent).toBe("tab for web-01");
  });

  it("lists a rail item in the Navigation visibility toggles and toggles it", async () => {
    await mount();
    const onChange = vi.fn();
    render(
      <NavigationVisibilityToggles hidden={new Set()} onChange={onChange} />,
    );
    const row = screen.getByTestId("nav-toggle-fixture-panel");
    expect(row.textContent).toContain("Fixture title");
    fireEvent.click(row.querySelector("button, [role=switch]")!);
    expect(onChange).toHaveBeenCalledWith(new Set(["fixture-panel"]));
  });

  it("drops the toggle when the plugin goes away", async () => {
    const app = await mount();
    const { rerender } = render(
      <NavigationVisibilityToggles hidden={new Set()} onChange={() => {}} />,
    );
    expect(screen.queryByTestId("nav-toggle-fixture-panel")).not.toBeNull();
    await app.deactivate();
    rendered = null;
    rerender(
      <NavigationVisibilityToggles hidden={new Set()} onChange={() => {}} />,
    );
    expect(screen.queryByTestId("nav-toggle-fixture-panel")).toBeNull();
  });

  it("adds a host editor section to the SSH group in order", async () => {
    await mount();
    const ids = makeHostSshSubTabs((key) => key).map((tab) => tab.id);
    expect(ids.slice(0, 3)).toEqual([
      "ssh",
      "terminal-options",
      "fixture-section",
    ]);
    expect(makeHostTabs((key) => key).map((tab) => tab.id)).not.toContain(
      "fixture-section",
    );
  });

  it("renders a host editor section with the editor's setters", async () => {
    const app = await mount();
    const setField = vi.fn();
    const container = app.renderHostEditorSection("fixture-section", {
      setField,
    });
    fireEvent.click(container.querySelector("button")!);
    expect(setField).toHaveBeenCalledWith("fixture", true);
  });

  it("offers a host action only where it applies, and picks it as the default connect", async () => {
    await mount();
    const on = host({ enableFixture: true } as Partial<Host>);
    const off = host();
    expect(hostActionsFor(listHostActions(), on).map((a) => a.id)).toEqual([
      "fixture-connect",
    ]);
    expect(hostActionsFor(listHostActions(), off)).toEqual([]);
    expect(defaultConnectAction(listHostActions(), on)?.id).toBe(
      "fixture-connect",
    );
    expect(resolveHostTabType(on)).toBe("fixture-tab");
  });

  it("exposes registered host actions through the SDK's useHostActions", async () => {
    await mount();
    function Probe() {
      const actions = useHostActions();
      return <span>{actions.map((a) => a.id).join(",")}</span>;
    }
    render(<Probe />);
    expect(await screen.findByText("fixture-connect")).toBeTruthy();
  });

  it("exposes a registered tab's activityTypes through useActivityTypes", async () => {
    await mount();
    function Probe() {
      const types = useActivityTypes();
      return <span>{types.join(",")}</span>;
    }
    render(<Probe />);
    expect(await screen.findByText(/fixture_activity/)).toBeTruthy();
  });

  it("registers a homepage widget type readable through the SDK", async () => {
    await mount();
    expect(homepageWidgetType("fixture-widget")?.name).toBe("Fixture Widget");
    function Probe() {
      const types = useHomepageWidgetTypes();
      return <span>{types.map((w) => w.id).join(",")}</span>;
    }
    render(<Probe />);
    expect(await screen.findByText("fixture-widget")).toBeTruthy();
  });

  it("offers a per-host palette entry that runs against the shell", async () => {
    const app = await mount();
    const target = host({ enableFixture: true } as Partial<Host>);
    const entries = paletteEntriesFor(listPaletteEntries(), "host", target);
    expect(entries.map((entry) => entry.id)).toEqual(["fixture-entry"]);
    expect(paletteEntriesFor(listPaletteEntries(), "host", host())).toEqual([]);
    entries[0].run(shell, target);
    expect(app.shellCalls).toEqual([
      { method: "openTab", args: [target, "fixture-tab"] },
    ]);
  });

  it("renders a dashboard card that can reach the shell", async () => {
    const app = await mount();
    const container = app.renderDashboardCard("fixture-card");
    fireEvent.click(container.querySelector("button")!);
    expect(app.shellCalls).toEqual([
      { method: "openSingletonTab", args: ["fixture-tab"] },
    ]);
  });

  it("renders a custom settings field from the registered component", async () => {
    await mount(["fixture.use"]);
    render(
      <SettingsFieldRow
        pluginId="fixture"
        field={{ key: "probe", type: "custom", component: "probe" }}
        values={{}}
        setValue={() => {}}
        running
      />,
    );
    await waitFor(() => expect(screen.getByText("allowed")).toBeTruthy());
  });

  it("resolves a short permission name against the plugin's namespace", async () => {
    const app = await mount([]);
    const container = app.renderSettingsComponent("probe");
    expect(container.textContent).toBe("denied");
  });
});
