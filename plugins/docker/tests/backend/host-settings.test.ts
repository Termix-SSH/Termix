import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { PluginCapabilityError } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";
import {
  normalizeImportedHost,
  readDockerHostSettings,
} from "../../src/backend/host-settings.js";
import {
  diffContainerStates,
  parseContainerStates,
} from "../../src/backend/container-state.js";
import { manifest, startServer, type TestServer } from "./server";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

describe("docker activate", () => {
  it("fails closed without network:serve", async () => {
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities.filter(
        (cap) => cap !== "network:serve",
      ),
      router: () => express.Router(),
    });
    await expect(activate(mock.ctx)).rejects.toBeInstanceOf(
      PluginCapabilityError,
    );
  });

  it("cannot reach a host without ssh:connect", async () => {
    server = await startServer({
      mock: {
        capabilities: manifest.capabilities.filter(
          (cap) => cap !== "ssh:connect",
        ),
      },
    });
    const response = await server.request("POST", "/ssh/connect", {
      body: { sessionId: "s1", hostId: 7 },
    });
    expect(response.status).toBe(500);
  });

  it("registers its import normalizer", async () => {
    server = await startServer();
    expect(
      server.mock.ctx.registry.consume("docker.hostImportNormalizer"),
    ).toBe(normalizeImportedHost);
  });
});

describe("docker host settings", () => {
  it("reads the switch and runtime with defaults", async () => {
    server = await startServer({ dockerOn: false });
    expect(await readDockerHostSettings(server.mock.ctx, 7)).toEqual({
      enabled: false,
      runtime: "docker",
    });
    await server.mock.ctx.settings.setHost(7, "enableDocker", true);
    await server.mock.ctx.settings.setHost(7, "containerRuntime", "podman");
    expect(await readDockerHostSettings(server.mock.ctx, 7)).toEqual({
      enabled: true,
      runtime: "podman",
    });
  });

  it("takes an export's nested settings over the old flat fields", () => {
    expect(
      normalizeImportedHost({
        enableDocker: false,
        pluginSettings: {
          docker: { enableDocker: true, containerRuntime: "podman" },
        },
      }),
    ).toEqual({ enableDocker: true, containerRuntime: "podman" });
  });

  it("reads 2.8 flat fields and proxmox-created rows", () => {
    expect(
      normalizeImportedHost({
        enableDocker: 1,
        dockerConfig: '{"runtime":"podman"}',
      }),
    ).toEqual({ enableDocker: true, containerRuntime: "podman" });
    expect(normalizeImportedHost({ enableDocker: true })).toEqual({
      enableDocker: true,
    });
    expect(normalizeImportedHost({ name: "plain" })).toBeNull();
  });
});

/**
 * The polling side needs SSH, so what is tested here is the pure part:
 * turning `ps` output into states, and two snapshots into events.
 */
describe("container state", () => {
  it("reads name, state and health out of the ps output", () => {
    const states = parseContainerStates(
      [
        '{"name":"web","state":"running","status":"Up 2 hours"}',
        "",
        "not json at all",
        '{"state":"running"}',
        '{"name":"api","state":"running","status":"Up 1 hour (unhealthy)"}',
      ].join("\n"),
    );
    expect([...states.keys()]).toEqual(["web", "api"]);
    expect(states.get("api")).toEqual({ state: "running", unhealthy: true });
  });

  it("reports transitions and skips containers seen for the first time", () => {
    const running = { state: "running", unhealthy: false };
    const exited = { state: "exited", unhealthy: false };
    const restarting = { state: "restarting", unhealthy: false };
    expect(
      diffContainerStates(
        new Map([
          ["web", running],
          ["db", exited],
          ["cache", running],
        ]),
        new Map([
          ["web", exited],
          ["db", running],
          ["cache", restarting],
          ["new", running],
        ]),
      ),
    ).toEqual([
      { container: "web", event: "exited" },
      { container: "db", event: "started" },
      { container: "cache", event: "restarting" },
    ]);
  });
});
