import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import { PluginsTab } from "@/plugins/PluginsTab";
import { docsUrl } from "@/lib/docs";

const plugin = {
  id: "demo",
  name: "Demo Plugin",
  description: "Does demo things",
  version: "1.0.0",
  latestVersion: "1.0.0",
  installed: true,
  inRegistry: true,
  enabled: true,
  status: "running",
  updateAvailable: false,
  pinnedVersion: null,
  addedCapabilities: [],
  capabilities: [],
  contributes: {},
  versions: [],
  downloads: null,
  managedByServer: false,
  kinds: [] as string[],
  category: "",
  unsupported: false,
  needsTermix: null as string | null,
};
let linked = false;
let extra: Array<typeof plugin> = [];

function listed(
  id: string,
  overrides: Partial<typeof plugin> = {},
): typeof plugin {
  return {
    ...plugin,
    id,
    name: `Listed ${id}`,
    installed: false,
    status: null as never,
    ...overrides,
  };
}

vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    plugins: [plugin, ...extra],
    loading: false,
    refreshing: false,
    refresh: vi.fn(),
    registryError: null,
    managedByServer: linked,
    busy: new Set(),
    consent: null,
    setConsent: vi.fn(),
    confirmConsent: vi.fn(),
    developerMode: false,
    signedOnly: false,
    registries: [],
  }),
}));

async function renderTab() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <PluginsTab />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  linked = false;
  extra = [];
  plugin.managedByServer = false;
});
afterEach(cleanup);

describe("PluginsTab", () => {
  it("points to the Registries tab and links the submit guide", async () => {
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));

    expect(
      screen.getByText(en.plugins.manager.registries.browseHint, {
        exact: false,
      }),
    ).toBeTruthy();
    const link = screen.getByText(en.plugins.manager.communitySubmit);
    expect(link.getAttribute("href")).toBe(docsUrl("communityRegistry"));
  });

  it("hides installed plugins in Browse until shown", async () => {
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));

    expect(screen.queryByText("Demo Plugin")).toBeNull();
    expect(screen.getByText(en.plugins.manager.allInstalled)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(localStorage.getItem("pluginsTab.browseInstalled")).toBe("show");
  });

  it("filters Browse by what a plugin adds", async () => {
    extra = [
      listed("layout", { kinds: ["layouts", "tabs"] }),
      listed("tabs", { kinds: ["tabs"] }),
    ];
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));
    expect(screen.getByText("Listed layout")).toBeTruthy();
    expect(screen.getByText("Listed tabs")).toBeTruthy();

    const [layoutsFilter] = screen.getAllByRole("button", {
      name: new RegExp(`^${en.plugins.manager.kinds.layouts}`),
    });
    fireEvent.click(layoutsFilter);

    expect(screen.getByText("Listed layout")).toBeTruthy();
    expect(screen.queryByText("Listed tabs")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: `Remove filter ${en.plugins.manager.kinds.layouts}`,
      }),
    );
    expect(screen.getByText("Listed tabs")).toBeTruthy();
  });

  it("hides plugins this build can't run until shown", async () => {
    extra = [
      listed("later", {
        unsupported: true,
        needsTermix: ">=26.11.0",
        latestVersion: null as never,
      }),
    ];
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));
    expect(screen.queryByText("Listed later")).toBeNull();

    fireEvent.click(
      screen.getByRole("switch", { name: /Show unsupported \(1\)/ }),
    );

    expect(screen.getByText("Listed later")).toBeTruthy();
    expect(screen.getByText("Needs Termix >=26.11.0")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: en.plugins.manager.install }),
    ).toBeNull();
  });

  it("pages a long Browse list", async () => {
    extra = Array.from({ length: 30 }, (_, i) =>
      listed(`p${String(i).padStart(2, "0")}`),
    );
    localStorage.setItem("pluginsTab.view", "list");
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));

    expect(screen.getAllByText(/^Listed p/)).toHaveLength(24);
    expect(screen.getByText("1-24 of 30")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: en.plugins.manager.pager.next }),
    );
    expect(screen.getAllByText(/^Listed p/)).toHaveLength(6);
    expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  });

  it("switches to a table and remembers it", async () => {
    await renderTab();
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByLabelText(en.plugins.manager.columns.title),
    ).toBeTruthy();

    fireEvent.click(screen.getByLabelText(en.panel.listView));

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(en.plugins.manager.table.version)).toBeTruthy();
    expect(
      screen.queryByLabelText(en.plugins.manager.columns.title),
    ).toBeNull();
    expect(localStorage.getItem("pluginsTab.view")).toBe("list");

    cleanup();
    await renderTab();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("uses the saved column count for the grid", async () => {
    localStorage.setItem("pluginsTab.columns", "5");
    const { container } = await renderTab();
    const grid = container.querySelector<HTMLElement>(
      "[style*='grid-template-columns']",
    );
    expect(grid?.style.gridTemplateColumns).toContain("/ 5");
  });

  it("fits auto columns to the tab width, not the window", async () => {
    const { container } = await renderTab();
    const grid = container.querySelector<HTMLElement>(
      "[style*='grid-template-columns']",
    );
    expect(grid?.style.gridTemplateColumns).toContain("auto-fill");
  });

  it("lets a linked desktop switch a plugin its server does not decide", async () => {
    linked = true;
    await renderTab();
    const toggle = () =>
      screen.getByRole("button", { name: en.plugins.manager.disable });
    expect(toggle().hasAttribute("disabled")).toBe(false);

    cleanup();
    plugin.managedByServer = true;
    await renderTab();
    expect(toggle().hasAttribute("disabled")).toBe(true);
  });
});
