import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  alerts: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
}));

vi.mock("../../notify/core-notify.js", () => ({
  sendCoreAlert: async (alert: Record<string, unknown>) => {
    state.alerts.push(alert);
  },
}));

import { noteSignerChanges, recordSigners } from "../../plugins/signers.js";
import { TRUSTED_PLUGIN_KEYS } from "../../plugins/trust.js";
import type { LoadedPlugin } from "../../plugins/loader.js";

function plugin(id: string, signedBy?: string, signedTier = "official") {
  return {
    id,
    signedBy,
    signedTier: signedBy ? signedTier : undefined,
    manifest: { id, name: id.toUpperCase(), version: "2.0.0" },
  } as unknown as LoadedPlugin;
}

beforeEach(() => {
  state.settings.clear();
  state.alerts = [];
});

describe("recordSigners", () => {
  it("says nothing the first time it sees a plugin", async () => {
    expect(await recordSigners([plugin("docker", "k1")])).toEqual([]);
    expect(await recordSigners([plugin("docker", "k1")])).toEqual([]);
  });

  it("reports a new key for a known plugin", async () => {
    await recordSigners([plugin("docker", "k1")]);
    expect(await recordSigners([plugin("docker", "k2")])).toEqual([
      {
        id: "docker",
        name: "DOCKER",
        version: "2.0.0",
        from: { key: "k1", tier: "official" },
        to: { key: "k2", tier: "official" },
      },
    ]);
    // Reported once, then it is the known key.
    expect(await recordSigners([plugin("docker", "k2")])).toEqual([]);
  });

  it("ignores unsigned plugins and the planned move off the pre-chain key", async () => {
    await recordSigners([
      plugin("docker", TRUSTED_PLUGIN_KEYS[0].id),
      plugin("local"),
    ]);
    expect(
      await recordSigners([plugin("docker", "chain-key"), plugin("local")]),
    ).toEqual([]);
  });

  it("still reports a pre-chain key moving to another tier", async () => {
    await recordSigners([plugin("docker", TRUSTED_PLUGIN_KEYS[0].id)]);
    const changes = await recordSigners([plugin("docker", "own", "custom")]);
    expect(changes).toHaveLength(1);
  });
});

describe("noteSignerChanges", () => {
  it("sends one admin alert per new key, naming every plugin", async () => {
    await noteSignerChanges([plugin("docker", "k1"), plugin("tunnels", "k1")]);
    expect(state.alerts).toEqual([]);
    await noteSignerChanges([plugin("docker", "k2"), plugin("tunnels", "k2")]);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({
      audience: "admins",
      severity: "info",
      category: "termix.plugin-signer",
    });
    expect(String(state.alerts[0].body)).toContain(
      "DOCKER 2.0.0, TUNNELS 2.0.0",
    );
  });

  it("warns when a plugin moves to a key from another source", async () => {
    await noteSignerChanges([plugin("docker", "k1")]);
    await noteSignerChanges([plugin("docker", "own", "custom")]);
    expect(state.alerts[0]).toMatchObject({ severity: "warning" });
  });
});
