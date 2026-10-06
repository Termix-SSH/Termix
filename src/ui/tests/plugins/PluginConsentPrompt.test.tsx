import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { PluginConsentPrompt } from "@/plugins/PluginConsentPrompt";
import { mergePlugins } from "@/plugins/plugin-model";

afterEach(cleanup);

const [plugin] = mergePlugins(
  [],
  [
    {
      id: "docker",
      name: "Docker",
      description: "",
      author: "Termix",
      category: "",
      versions: [],
      latestVersion: "1.0.0",
      installed: false,
      installedVersion: null,
      updateAvailable: false,
      addedCapabilities: [],
      pinnedVersion: null,
      autoUpdate: false,
      bundled: false,
    },
  ],
);

describe("PluginConsentPrompt", () => {
  it("lists notable capabilities and folds the low risk ones", () => {
    render(
      <PluginConsentPrompt
        request={{
          plugin,
          mode: "install",
          version: "1.0.0",
          capabilities: ["kv:own", "ssh:connect", "ui:surface"],
        }}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByText("plugins.capabilities.ssh:connect.title"),
    ).toBeTruthy();
    expect(screen.queryByText("plugins.capabilities.kv:own.title")).toBeNull();
    expect(screen.getByText("plugins.manager.consent.minor")).toBeTruthy();
  });

  it("confirms and cancels", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PluginConsentPrompt
        request={{
          plugin,
          mode: "update",
          version: "1.1.0",
          capabilities: ["notify:send"],
        }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByText("plugins.manager.consent.updateExplain"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("plugins.manager.consent.agreeUpdate"));
    fireEvent.click(screen.getByText("common.cancel"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders nothing without a request", () => {
    const { container } = render(
      <PluginConsentPrompt
        request={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});
