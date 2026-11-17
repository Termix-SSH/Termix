import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginSummary } from "@/api/plugins-api";
import { mayPlaceForeign } from "@/plugin-host/frames/foreign-policy";
import {
  resetPluginStore,
  setPluginSummaries,
} from "@/plugin-host/plugin-store";
import {
  declareActionSlot,
  resetActionRegistry,
} from "@/shell/action-registry";

const summary = (id: string, uses: string[] = []): PluginSummary =>
  ({
    id,
    name: id,
    version: "1.0.0",
    enabled: true,
    state: "active",
    frontend: true,
    contributes: { uses },
  }) as unknown as PluginSummary;

beforeEach(() => {
  resetPluginStore();
  setPluginSummaries([
    summary("homepage"),
    summary("file-manager", ["terminal.view"]),
    summary("session-recording", ["session.remoteDisplay"]),
  ]);
  declareActionSlot({
    id: "host-metrics.managers",
    accepts: ["component"],
    pluginId: "host-metrics",
  });
  declareActionSlot({
    id: "session.remoteDisplay",
    accepts: ["component"],
    pluginId: "session-sharing",
  });
});

afterEach(() => {
  resetActionRegistry();
  resetPluginStore();
});

describe("who may place other plugins' views", () => {
  it("lets a plugin embed a tab only when a host action opens it", async () => {
    const { registerHostAction } = await import("@/sidebar/host-contributions");
    const remove = registerHostAction({
      id: "files",
      pluginId: "file-manager",
      titleKey: "files",
      kind: "open",
      tabType: "file_manager",
      when: () => true,
    } as never);
    expect(mayPlaceForeign("operations-center", "tab", "file_manager")).toBe(
      true,
    );
    expect(mayPlaceForeign("operations-center", "tab", "admin_settings")).toBe(
      false,
    );
    remove();
  });

  it("lets a plugin place the parts of a slot it declared", () => {
    expect(
      mayPlaceForeign("host-metrics", "slot", "host-metrics.managers"),
    ).toBe(true);
    expect(mayPlaceForeign("homepage", "slot", "host-metrics.managers")).toBe(
      false,
    );
  });

  it("does not let a plugin claim a slot by its name alone", () => {
    expect(mayPlaceForeign("session", "slot", "session.remoteDisplay")).toBe(
      false,
    );
    // An undeclared slot belongs to nobody yet.
    expect(mayPlaceForeign("proxmox", "slot", "proxmox.hostEditor")).toBe(
      false,
    );
  });

  it("lets a plugin read extension points and components under its own id", () => {
    expect(mayPlaceForeign("homepage", "extension", "homepage.widgets")).toBe(
      true,
    );
    expect(mayPlaceForeign("homepage", "extension", "docker.widgets")).toBe(
      false,
    );
    expect(mayPlaceForeign("homepage", "component", "terminal.view")).toBe(
      false,
    );
  });

  it("lets a plugin place what its manifest says it uses", () => {
    expect(mayPlaceForeign("file-manager", "component", "terminal.view")).toBe(
      true,
    );
    expect(
      mayPlaceForeign("session-recording", "slot", "session.remoteDisplay"),
    ).toBe(true);
  });

  it("refuses unknown kinds and odd ids", () => {
    expect(mayPlaceForeign("homepage", "frame", "homepage.widgets")).toBe(
      false,
    );
    expect(mayPlaceForeign("homepage", "extension", 5)).toBe(false);
    expect(mayPlaceForeign("homepage", "extension", "")).toBe(false);
    expect(
      mayPlaceForeign("homepage", "extension", `homepage.${"x".repeat(300)}`),
    ).toBe(false);
  });
});
