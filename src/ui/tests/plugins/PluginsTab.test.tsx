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
  installCount: null,
  installCountSource: null,
};

vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    plugins: [plugin],
    loading: false,
    refreshing: false,
    refresh: vi.fn(),
    registryError: null,
    managedByServer: false,
    busy: new Set(),
    consent: null,
    setConsent: vi.fn(),
    confirmConsent: vi.fn(),
    developerMode: false,
    signedOnly: false,
  }),
}));

async function renderTab() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <PluginsTab />
    </I18nextProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("PluginsTab", () => {
  it("tells people community plugins are coming and links the guide", async () => {
    await renderTab();
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));

    expect(
      screen.getByText(en.plugins.manager.communitySoon, { exact: false }),
    ).toBeTruthy();
    const link = screen.getByText(en.plugins.manager.communitySubmit);
    expect(link.getAttribute("href")).toBe(docsUrl("communityRegistry"));
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
});
