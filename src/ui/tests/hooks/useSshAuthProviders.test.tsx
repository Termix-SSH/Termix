import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getSshAuthProviders: vi.fn() }));
vi.mock("@/api/auth-methods-api", () => api);

import {
  invalidateSshAuthProviders,
  useSshAuthProviders,
} from "@/hooks/useSshAuthProviders";
import { registerSshAuthEditor } from "@/plugin-host/auth-registry";

function summary(type: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    labelKey: `hosts.filterAuth${type}`,
    pluginId: "core",
    fields: [],
    credentialType: false,
    needsUserInteraction: false,
    supportsBackground: true,
    available: true,
    ...extra,
  };
}

afterEach(() => {
  invalidateSshAuthProviders();
  vi.clearAllMocks();
});

describe("useSshAuthProviders", () => {
  it("lists the server's types, flags ones whose plugin is off, and merges editors", async () => {
    api.getSshAuthProviders.mockResolvedValue([
      summary("password", { credentialType: true }),
      summary("corp", { pluginId: "corp" }),
      summary("gone", {
        available: false,
        pluginId: "gone-plugin",
        missingPlugin: { id: "gone-plugin", name: "Gone" },
      }),
    ]);
    const dispose = registerSshAuthEditor({
      id: "corp",
      pluginId: "corp",
      titleKey: "corp:title",
    });
    try {
      const { result } = renderHook(() => useSshAuthProviders());
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.providers.map((p) => p.type)).toEqual([
        "password",
        "corp",
        "gone",
      ]);
      expect(result.current.find("corp")?.editorTitleKey).toBe("corp:title");
      expect(result.current.find("gone")).toMatchObject({
        available: false,
        missingPlugin: { name: "Gone" },
      });
    } finally {
      dispose();
    }
  });

  it("offers the built-in types while the server has not answered", () => {
    api.getSshAuthProviders.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSshAuthProviders());
    expect(result.current.loaded).toBe(false);
    expect(result.current.providers.map((p) => p.type)).toEqual([
      "password",
      "key",
      "credential",
      "agent",
      "none",
    ]);
  });
});
