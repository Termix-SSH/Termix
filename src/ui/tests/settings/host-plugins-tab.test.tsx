/**
 * The host editor's Plugins group.
 *
 * No bundled plugin declares host settings yet, so a fixture stands in for one.
 * The rule worth protecting is the empty case: with nothing to show, the tab
 * must not be registered at all rather than appearing blank.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";
import {
  HOST_PLUGINS_TAB_ID,
  syncHostPluginsTab,
} from "@/settings/host-plugins-tab";
import {
  getRegisteredHostEditorTab,
  unregisterHostEditorTab,
} from "@/sidebar/HostManagerTabs";
import { HostPluginSections } from "@/settings/HostPluginSections";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function plugin(overrides: Partial<PluginSummary> = {}): PluginSummary {
  return {
    id: "docker",
    name: "Docker",
    version: "1.0.0",
    enabled: true,
    state: "active",
    icon: "Box",
    contributes: {
      settings: {
        host: {
          enableKey: "enableDocker",
          enableLabelKey: "enableDocker.label",
          fields: [
            { key: "socketPath", type: "string", labelKey: "socket.label" },
          ],
        },
      },
    },
    ...overrides,
  } as PluginSummary;
}

beforeEach(() => {
  unregisterHostEditorTab(HOST_PLUGINS_TAB_ID);
});

afterEach(() => {
  cleanup();
  unregisterHostEditorTab(HOST_PLUGINS_TAB_ID);
});

describe("syncHostPluginsTab", () => {
  it("registers the tab when a plugin contributes host settings", () => {
    expect(syncHostPluginsTab([plugin()])).toBe(true);
    expect(getRegisteredHostEditorTab(HOST_PLUGINS_TAB_ID)).toBeDefined();
  });

  it("registers nothing when no plugin contributes", () => {
    expect(syncHostPluginsTab([])).toBe(false);
    expect(getRegisteredHostEditorTab(HOST_PLUGINS_TAB_ID)).toBeUndefined();
  });

  it("ignores a plugin with no host settings", () => {
    const other = plugin({
      id: "ai",
      contributes: { settings: { admin: [] } },
    });

    expect(syncHostPluginsTab([other])).toBe(false);
  });

  it("ignores a disabled plugin", () => {
    expect(syncHostPluginsTab([plugin({ enabled: false })])).toBe(false);
  });

  it("removes the tab once the last contributor goes", () => {
    syncHostPluginsTab([plugin()]);
    expect(getRegisteredHostEditorTab(HOST_PLUGINS_TAB_ID)).toBeDefined();

    syncHostPluginsTab([plugin({ enabled: false })]);

    expect(getRegisteredHostEditorTab(HOST_PLUGINS_TAB_ID)).toBeUndefined();
  });

  it("registers for a plugin declaring only an enable switch", () => {
    const bare = plugin({
      contributes: {
        settings: {
          host: { enableKey: "enableThing", enableLabelKey: "k", fields: [] },
        },
      },
    });

    expect(syncHostPluginsTab([bare])).toBe(true);
  });
});

describe("HostPluginSections", () => {
  it("shows the enable switch and hides the fields until it is on", () => {
    const setValue = vi.fn();
    render(
      <HostPluginSections
        plugins={[plugin()]}
        values={{ docker: { enableDocker: false } }}
        setValue={setValue}
      />,
    );

    expect(screen.getByText("plugins.docker.enableDocker.label")).toBeTruthy();
    expect(screen.queryByText("plugins.docker.socket.label")).toBeNull();
  });

  it("shows the fields once the enable switch is on", () => {
    render(
      <HostPluginSections
        plugins={[plugin()]}
        values={{ docker: { enableDocker: true } }}
        setValue={vi.fn()}
      />,
    );

    expect(screen.getByText("plugins.docker.socket.label")).toBeTruthy();
  });

  it("reports a change against the right plugin", () => {
    const setValue = vi.fn();
    render(
      <HostPluginSections
        plugins={[plugin()]}
        values={{ docker: { enableDocker: false } }}
        setValue={setValue}
      />,
    );

    fireEvent.click(screen.getAllByRole("button")[0]);

    expect(setValue).toHaveBeenCalledWith("docker", "enableDocker", true);
  });

  it("warns when the plugin is installed but not running", () => {
    render(
      <HostPluginSections
        plugins={[plugin({ state: "failed" })]}
        values={{ docker: {} }}
        setValue={vi.fn()}
      />,
    );

    expect(screen.getByText("settings.hostPluginNotRunning")).toBeTruthy();
  });

  it("renders nothing at all with no contributing plugins", () => {
    const { container } = render(
      <HostPluginSections plugins={[]} values={{}} setValue={vi.fn()} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("keeps two plugins' values apart", () => {
    const vault = plugin({
      id: "vault",
      name: "Vault",
      contributes: {
        settings: {
          host: {
            fields: [{ key: "role", type: "string", labelKey: "role.label" }],
          },
        },
      },
    });

    render(
      <HostPluginSections
        plugins={[plugin(), vault]}
        values={{
          docker: { enableDocker: true, socketPath: "/var/run/docker.sock" },
          vault: { role: "web" },
        }}
        setValue={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue("/var/run/docker.sock")).toBeTruthy();
    expect(screen.getByDisplayValue("web")).toBeTruthy();
  });
});
