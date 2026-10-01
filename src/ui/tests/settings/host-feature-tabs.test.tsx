/**
 * Generated host editor tabs, one per feature with manifest host settings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PluginSummary } from "@/api/plugins-api";
import {
  hostFeatureTabId,
  syncHostFeatureTabs,
} from "@/settings/host-feature-tabs";
import {
  getHostEditorSection,
  registerHostEditorSection,
  resetHostEditorSections,
} from "@/sidebar/HostManagerTabs";
import {
  HostFeatureFields,
  HostPluginSections,
} from "@/settings/HostPluginSections";
import { withPluginScope } from "@/plugin-host/scope";

const getPlugins = vi.fn();
vi.mock("@/api/plugins-api", () => ({
  getPlugins: () => getPlugins(),
}));

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
  resetHostEditorSections();
});

afterEach(() => {
  cleanup();
  resetHostEditorSections();
});

describe("syncHostFeatureTabs", () => {
  it("registers one tab per feature, labelled with its name", () => {
    const other = plugin({ id: "warpgate", name: "Warpgate" });
    expect(syncHostFeatureTabs([plugin(), other])).toEqual([
      "feature:docker",
      "feature:warpgate",
    ]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))?.label).toBe(
      "Docker",
    );
    expect(getHostEditorSection(hostFeatureTabId("warpgate"))).toBeDefined();
  });

  it("uses the manifest's editor group and order", () => {
    const placed = plugin({
      contributes: {
        settings: {
          host: {
            editorGroup: "ssh",
            editorOrder: 30,
            enableKey: "enableDocker",
            enableLabelKey: "k",
            fields: [],
          },
        },
      },
    });
    syncHostFeatureTabs([placed]);
    const section = getHostEditorSection(hostFeatureTabId("docker"));
    expect(section?.group).toBe("ssh");
    expect(section?.order).toBe(30);
  });

  it("defaults to the main strip", () => {
    syncHostFeatureTabs([plugin()]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))?.group).toBe("top");
  });

  it("gives a plugin with its own section a tab only in the defaults editor", () => {
    registerHostEditorSection({
      id: "docker-own",
      pluginId: "docker",
      group: "top",
      labelKey: "k",
      component: () => null,
    });
    expect(syncHostFeatureTabs([plugin()])).toEqual([
      hostFeatureTabId("docker"),
    ]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))?.defaults).toBe(
      "only",
    );
  });

  it("places the defaults tab where the plugin's own section sits", () => {
    registerHostEditorSection({
      id: "docker-own",
      pluginId: "docker",
      group: "ssh",
      order: 40,
      labelKey: "k",
      component: () => null,
    });
    syncHostFeatureTabs([plugin()]);
    const tab = getHostEditorSection(hostFeatureTabId("docker"));
    expect(tab?.group).toBe("ssh");
    expect(tab?.order).toBe(40);
  });

  it("gives a plugin with its own section no tab when nothing can have a default", () => {
    registerHostEditorSection({
      id: "proxmox-own",
      pluginId: "proxmox",
      group: "ssh",
      labelKey: "k",
      component: () => null,
    });
    const proxmox = plugin({
      id: "proxmox",
      name: "Proxmox",
      contributes: {
        settings: {
          host: {
            fields: [
              {
                key: "enableProxmox",
                type: "custom",
                component: "proxmoxHostSettings",
                defaultable: false,
              },
            ],
          },
        },
      },
    } as Partial<PluginSummary>);
    expect(syncHostFeatureTabs([proxmox])).toEqual([]);
    expect(getHostEditorSection(hostFeatureTabId("proxmox"))).toBeUndefined();
  });

  it("skips a plugin whose own section already covers the defaults editor", () => {
    registerHostEditorSection({
      id: "docker-own",
      pluginId: "docker",
      group: "top",
      labelKey: "k",
      defaults: true,
      component: () => null,
    });
    expect(syncHostFeatureTabs([plugin()])).toEqual([]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))).toBeUndefined();
  });

  it("offers a generated tab to both the host and the defaults editor", () => {
    syncHostFeatureTabs([plugin()]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))?.defaults).toBe(
      true,
    );
  });

  it("registers nothing for a plugin whose host fields are all hidden", () => {
    const own = plugin({
      contributes: {
        settings: {
          host: {
            fields: [
              { key: "port", type: "number", labelKey: "p", hidden: true },
            ],
          },
        },
      },
    } as Partial<PluginSummary>);
    expect(syncHostFeatureTabs([own])).toEqual([]);
  });

  it("ignores a plugin with no host settings", () => {
    const other = plugin({
      id: "ai",
      contributes: { settings: { admin: [] } },
    });
    expect(syncHostFeatureTabs([other])).toEqual([]);
  });

  it("ignores a disabled plugin", () => {
    expect(syncHostFeatureTabs([plugin({ enabled: false })])).toEqual([]);
  });

  it("removes a tab once its feature goes", () => {
    syncHostFeatureTabs([plugin()]);
    expect(getHostEditorSection(hostFeatureTabId("docker"))).toBeDefined();

    syncHostFeatureTabs([plugin({ enabled: false })]);

    expect(getHostEditorSection(hostFeatureTabId("docker"))).toBeUndefined();
  });

  it("registers for a plugin declaring only an enable switch", () => {
    const bare = plugin({
      contributes: {
        settings: {
          host: { enableKey: "enableThing", enableLabelKey: "k", fields: [] },
        },
      },
    });
    expect(syncHostFeatureTabs([bare])).toEqual(["feature:docker"]);
  });
});

describe("HostPluginSections hidden fields", () => {
  it("does not draw a field the plugin edits itself", () => {
    const own = plugin({
      contributes: {
        settings: {
          host: {
            fields: [
              { key: "shown", type: "string", labelKey: "shown.label" },
              {
                key: "secretish",
                type: "string",
                labelKey: "hidden.label",
                hidden: true,
              },
            ],
          },
        },
      },
    } as Partial<PluginSummary>);
    render(
      <HostPluginSections plugins={[own]} values={{}} setValue={() => {}} />,
    );
    expect(screen.queryByText("hidden.label")).toBeNull();
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

    expect(screen.getByText("docker:enableDocker.label")).toBeTruthy();
    expect(screen.queryByText("docker:socket.label")).toBeNull();
  });

  it("shows the fields once the enable switch is on", () => {
    render(
      <HostPluginSections
        plugins={[plugin()]}
        values={{ docker: { enableDocker: true } }}
        setValue={vi.fn()}
      />,
    );

    expect(screen.getByText("docker:socket.label")).toBeTruthy();
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

  it("warns when the feature is unavailable", () => {
    render(
      <HostPluginSections
        plugins={[plugin({ state: "failed" })]}
        values={{ docker: {} }}
        setValue={vi.fn()}
      />,
    );

    expect(screen.getByText("settings.featureUnavailable")).toBeTruthy();
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

describe("HostFeatureFields", () => {
  it("draws the calling plugin's fields and writes into its pluginSettings", async () => {
    getPlugins.mockResolvedValue([
      plugin(),
      plugin({ id: "warpgate", name: "Warpgate" }),
    ]);
    const form = {
      pluginSettings: {
        docker: { enableDocker: false },
        warpgate: { enableDocker: true },
      },
    };
    const updateForm = vi.fn();
    const Scoped = withPluginScope("docker", HostFeatureFields);
    render(<Scoped form={form} updateForm={updateForm} />);

    await waitFor(() =>
      expect(screen.getByText("docker:enableDocker.label")).toBeTruthy(),
    );
    expect(screen.getAllByText("Docker")).toHaveLength(1);
    expect(screen.queryByText("Warpgate")).toBeNull();

    fireEvent.click(screen.getAllByRole("button")[0]);
    const patch = updateForm.mock.calls[0][0];
    expect(patch(form).pluginSettings).toEqual({
      docker: { enableDocker: true },
      warpgate: { enableDocker: true },
    });
  });

  it("renders nothing outside a plugin", async () => {
    getPlugins.mockResolvedValue([plugin()]);
    const { container } = render(
      <HostFeatureFields form={{}} updateForm={vi.fn()} />,
    );
    await waitFor(() => expect(getPlugins).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
