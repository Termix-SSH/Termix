import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

function host(enableDocker: boolean) {
  return {
    id: "7",
    name: "box",
    ip: "10.0.0.7",
    port: 22,
    username: "root",
    enableSsh: true,
    pluginSettings: { docker: { enableDocker } },
  };
}

function stubApi(connectResult: Record<string, unknown>) {
  const post = vi.fn(async (url: string) => {
    if (url === "/ssh/connect") return { data: connectResult };
    return { data: { success: true } };
  });
  const get = vi.fn(async (url: string) => {
    if (url.startsWith("/validate/")) {
      return {
        data: { available: true, version: "27.1.1", runtime: "docker" },
      };
    }
    if (url.startsWith("/containers/")) {
      return {
        data: [
          {
            id: "abc123",
            name: "web",
            image: "nginx",
            status: "Up",
            state: "running",
            ports: "",
            created: "",
          },
        ],
      };
    }
    return { data: {} };
  });
  return {
    post,
    get,
    delete: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as {
    post: typeof post;
    get: typeof get;
  } & PluginApiClient;
}

describe("DockerManager", () => {
  it("says Docker is off for a host without the switch", async () => {
    const api = stubApi({ success: true });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      hosts: [host(false)],
      api,
    });
    rendered.renderTab("docker", {
      host: host(false),
      label: "box",
      isVisible: true,
    });
    expect(
      await screen.findByText("Docker is not enabled for this host"),
    ).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("connects through the plugin api and lists containers", async () => {
    const api = stubApi({ success: true, status: "success" });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      hosts: [host(true)],
      api,
    });
    rendered.renderTab("docker", {
      host: host(true),
      label: "box",
      isVisible: true,
    });
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/ssh/connect",
        expect.objectContaining({ hostId: 7 }),
      ),
    );
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        expect.stringMatching(/^\/validate\//),
      ),
    );
  });

  it("opens the code prompt when the host asks for one", async () => {
    const api = stubApi({
      requires_totp: true,
      sessionId: "s1",
      prompt: "Verification code:",
    });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      hosts: [host(true)],
      api,
    });
    rendered.renderTab("docker", {
      host: host(true),
      label: "box",
      isVisible: true,
    });
    expect(await screen.findByText("Verification code:")).toBeTruthy();
  });
});
