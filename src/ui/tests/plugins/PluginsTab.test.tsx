import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import { PluginsTab } from "@/plugins/PluginsTab";
import { docsUrl } from "@/lib/docs";

vi.mock("@/plugins/use-plugins-manager", () => ({
  usePluginsManager: () => ({
    plugins: [],
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

afterEach(cleanup);

describe("PluginsTab", () => {
  it("tells people community plugins are coming and links the guide", async () => {
    const i18n = i18next.createInstance();
    await i18n.use(initReactI18next).init({
      lng: "en",
      resources: { en: { translation: en } },
    });

    render(
      <I18nextProvider i18n={i18n}>
        <PluginsTab />
      </I18nextProvider>,
    );
    fireEvent.click(screen.getByText(en.plugins.manager.tabs.browse));

    expect(
      screen.getByText(en.plugins.manager.communitySoon, { exact: false }),
    ).toBeTruthy();
    const link = screen.getByText(en.plugins.manager.communitySubmit);
    expect(link.getAttribute("href")).toBe(docsUrl("communityRegistry"));
  });
});
