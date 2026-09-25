import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@termix/plugin-sdk/frontend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@termix/plugin-sdk/frontend")>()),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${Object.values(values).join(" ")}` : key,
  }),
  usePluginApi: () => api,
}));

const { AcmeStatusSetting } =
  await import("../../src/frontend/AcmeStatusSetting");

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
  api.get.mockReset();
});

describe("acme-ssl activate", () => {
  it("registers the status settings component and removes it on deactivate", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.settingsComponents()).toEqual(["status"]);
    await rendered.deactivate();
    expect(rendered.registered.settingsComponents()).toEqual([]);
    rendered = null;
  });
});

describe("AcmeStatusSetting", () => {
  it("shows the served certificate and the last error", async () => {
    api.get.mockResolvedValue({
      data: {
        tls: {
          enabled: true,
          certificate: {
            issuer: "CN=R11",
            names: ["termix.example.com"],
            notAfter: "2030-01-01T00:00:00.000Z",
            selfSigned: false,
          },
        },
        state: {
          lastAttemptAt: null,
          lastIssuedAt: null,
          lastError: "rate limited",
        },
        autoRenew: true,
        missing: null,
      },
    });
    render(
      <AcmeStatusSetting
        pluginId="acme-ssl"
        values={{}}
        setValue={() => {}}
        running
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("status.names termix.example.com")).toBeTruthy(),
    );
    expect(screen.getByText("status.lastError rate limited")).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith("/status");
  });
});
