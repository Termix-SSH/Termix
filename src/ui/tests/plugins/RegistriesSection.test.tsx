import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import { RegistriesSection } from "@/plugins/RegistriesSection";
import type { PluginsManager } from "@/plugins/use-plugins-manager";

const api = vi.hoisted(() => ({
  getRegistries: vi.fn(),
  previewRegistry: vi.fn(),
  addRegistry: vi.fn(),
  setRegistryEnabled: vi.fn(),
  removeRegistry: vi.fn(),
}));

vi.mock("@/api/plugins-api", () => api);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const manager = {
  registries: [],
  managedByServer: false,
  refresh: vi.fn(async () => {}),
} as unknown as PluginsManager;

function state(communityEnabled = false) {
  return {
    managedByServer: false,
    official: { id: "official", url: "https://example.com/official.json" },
    community: {
      id: "community",
      url: "https://example.com/community.json",
      enabled: communityEnabled,
    },
    custom: [],
  };
}

async function renderSection() {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: en } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <RegistriesSection manager={manager} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getRegistries.mockResolvedValue(state());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RegistriesSection", () => {
  it("asks before turning community plugins on", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderSection();
    const toggle = await screen.findByRole("switch");

    fireEvent.click(toggle);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toContain(
      en.plugins.manager.registries.communityConfirmBody,
    );
    expect(api.setRegistryEnabled).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    api.getRegistries.mockResolvedValue(state(true));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(api.setRegistryEnabled).toHaveBeenCalledWith("community", true),
    );
  });

  it("does not ask when turning community plugins off", async () => {
    const confirm = vi.spyOn(window, "confirm");
    api.getRegistries.mockResolvedValue(state(true));
    await renderSection();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() =>
      expect(api.setRegistryEnabled).toHaveBeenCalledWith("community", false),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("checks a registry before adding it with the key it showed", async () => {
    api.previewRegistry.mockResolvedValue({
      id: "acme",
      name: "Acme Plugins",
      url: "https://acme.example/index.json",
      keyId: "abcd1234abcd1234",
      plugins: 3,
    });
    api.addRegistry.mockResolvedValue({
      id: "acme",
      name: "Acme Plugins",
      url: "https://acme.example/index.json",
      keyId: "abcd1234abcd1234",
      enabled: true,
      addedAt: "",
    });
    await renderSection();
    fireEvent.click(await screen.findByText(en.plugins.manager.registries.add));
    fireEvent.change(
      screen.getByLabelText(en.plugins.manager.registries.urlLabel),
      { target: { value: "https://acme.example/index.json" } },
    );
    fireEvent.click(screen.getByText(en.plugins.manager.registries.check));

    expect(await screen.findByText("Acme Plugins")).toBeTruthy();
    expect(screen.getByText("Key abcd1234abcd1234")).toBeTruthy();
    expect(api.addRegistry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(en.plugins.manager.registries.addConfirm));
    await waitFor(() =>
      expect(api.addRegistry).toHaveBeenCalledWith(
        "https://acme.example/index.json",
        "abcd1234abcd1234",
      ),
    );
  });
});
