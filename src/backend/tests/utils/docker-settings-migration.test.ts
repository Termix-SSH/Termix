/**
 * The Docker host settings migration.
 *
 * An upgrade must be lossless: every host with Docker on, and every host on
 * Podman, must come through into the docker plugin's host settings, whatever
 * shape the engine returned the flag in. Running it twice must not duplicate
 * or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pluginRows: [] as Array<{
    pluginId: string;
    scope: string;
    scopeId: string | null;
    key: string;
    value: string | null;
  }>,
  hostRows: [] as Array<Record<string, unknown>>,
  pluginInstalled: true,
  columnsGone: false,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "docker" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    getAll: async (_pluginId: string, scope: string, scopeId: string | null) =>
      state.pluginRows.filter(
        (row) => row.scope === scope && row.scopeId === scopeId,
      ),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = state.pluginRows.find(
        (row) =>
          row.scope === scope && row.scopeId === scopeId && row.key === key,
      );
      if (existing) {
        existing.value = value;
        return;
      }
      state.pluginRows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
}));

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async () => {
    if (state.columnsGone) throw new Error("no such column: enable_docker");
    return state.hostRows;
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import {
  dockerSettingsFromRow,
  runDockerSettingsMigration,
} from "../../utils/crypto-migration/docker-settings-migration.js";

const hostValues = (hostId: number) =>
  Object.fromEntries(
    state.pluginRows
      .filter((row) => row.scope === "host" && row.scopeId === String(hostId))
      .map((row) => [row.key, JSON.parse(row.value ?? "null")]),
  );

beforeEach(() => {
  state.pluginRows = [];
  state.hostRows = [];
  state.pluginInstalled = true;
  state.columnsGone = false;
});

describe("dockerSettingsFromRow", () => {
  it("reads SQLite integers, real booleans and strings", () => {
    expect(
      dockerSettingsFromRow({ id: 1, enable_docker: 1, docker_config: null }),
    ).toEqual({ enableDocker: true });
    expect(
      dockerSettingsFromRow({
        id: 1,
        enable_docker: true,
        docker_config: null,
      }),
    ).toEqual({ enableDocker: true });
    expect(
      dockerSettingsFromRow({ id: 1, enable_docker: 0, docker_config: null }),
    ).toEqual({});
    expect(
      dockerSettingsFromRow({
        id: 1,
        enable_docker: false,
        docker_config: null,
      }),
    ).toEqual({});
  });

  it("keeps a Podman runtime and ignores the default or broken config", () => {
    expect(
      dockerSettingsFromRow({
        id: 1,
        enable_docker: 1,
        docker_config: '{"runtime":"podman"}',
      }),
    ).toEqual({ enableDocker: true, containerRuntime: "podman" });
    expect(
      dockerSettingsFromRow({
        id: 1,
        enable_docker: 1,
        docker_config: '{"runtime":"docker"}',
      }),
    ).toEqual({ enableDocker: true });
    expect(
      dockerSettingsFromRow({
        id: 1,
        enable_docker: 1,
        docker_config: "{oops",
      }),
    ).toEqual({ enableDocker: true });
  });
});

describe("runDockerSettingsMigration", () => {
  it("moves every host's docker options and skips hosts with nothing set", async () => {
    state.hostRows = [
      { id: 1, enable_docker: 1, docker_config: null },
      { id: 2, enable_docker: 1, docker_config: '{"runtime":"podman"}' },
      { id: 3, enable_docker: 0, docker_config: null },
    ];

    const result = await runDockerSettingsMigration();

    expect(result).toEqual({ hostsMoved: 2, hostsSkipped: 0 });
    expect(hostValues(1)).toEqual({ enableDocker: true });
    expect(hostValues(2)).toEqual({
      enableDocker: true,
      containerRuntime: "podman",
    });
    expect(hostValues(3)).toEqual({});
  });

  it("changes nothing when run twice", async () => {
    state.hostRows = [
      { id: 1, enable_docker: 1, docker_config: '{"runtime":"podman"}' },
    ];
    await runDockerSettingsMigration();
    const before = JSON.stringify(state.pluginRows);

    const second = await runDockerSettingsMigration();

    expect(second).toEqual({ hostsMoved: 0, hostsSkipped: 1 });
    expect(JSON.stringify(state.pluginRows)).toBe(before);
  });

  it("keeps a value already saved in the plugin", async () => {
    state.pluginRows.push({
      pluginId: "docker",
      scope: "host",
      scopeId: "1",
      key: "enableDocker",
      value: "false",
    });
    state.hostRows = [{ id: 1, enable_docker: 1, docker_config: null }];

    await runDockerSettingsMigration();

    expect(hostValues(1)).toEqual({ enableDocker: false });
  });

  it("does nothing before the plugin row exists or once the columns are gone", async () => {
    state.hostRows = [{ id: 1, enable_docker: 1, docker_config: null }];
    state.pluginInstalled = false;
    expect(await runDockerSettingsMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
    });

    state.pluginInstalled = true;
    state.columnsGone = true;
    expect(await runDockerSettingsMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
    });
    expect(state.pluginRows).toEqual([]);
  });
});
