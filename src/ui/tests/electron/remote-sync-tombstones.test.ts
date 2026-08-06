import Module from "node:module";
import { createRequire } from "node:module";
import os from "node:os";
import { beforeEach, describe, expect, it } from "vitest";

// remote-sync.cjs is CommonJS and pulls in `electron` at load time, which does
// not exist outside the Electron runtime. vi.mock cannot reach a require() made
// through createRequire, so the stub is injected into the CJS loader itself.
const electronStub = {
  app: { getPath: () => os.tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => {} },
};
const loader = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = loader._load;
loader._load = (request, parent, isMain) =>
  request === "electron" ? electronStub : originalLoad(request, parent, isMain);

const require = createRequire(import.meta.url);

type Engine = {
  stop: () => void;
  pullSide: (
    baseUrl: string,
    token: string,
    entityType: string,
    since: string | null,
  ) => Promise<unknown[]>;
  pullTombstones: (
    baseUrl: string,
    token: string,
    entityType: string,
    since: string | null,
  ) => Promise<unknown[]>;
  pushRow: (...args: unknown[]) => Promise<void>;
  pushTombstone: (
    baseUrl: string,
    token: string,
    entityType: string,
    syncId: string,
  ) => Promise<void>;
  syncEntity: (args: {
    entityType: string;
    remoteBaseUrl: string;
    remoteJwt: string;
    since: string | null;
  }) => Promise<{ syncedAt: string }>;
};

const REMOTE = "https://server.example";
const CURSOR = "2026-07-29T10:24:44.501Z";

describe("remote sync tombstone application", () => {
  let engine: Engine;
  let pushed: Array<{ baseUrl: string; syncId: string }>;
  let fullPulls: string[];

  beforeEach(() => {
    const { initRemoteSync } = require("../../../../electron/remote-sync.cjs");
    engine = initRemoteSync(() => null) as Engine;
    engine.stop();
    pushed = [];
    fullPulls = [];
    engine.pushRow = async () => {};
    engine.pushTombstone = async (baseUrl, _token, _entityType, syncId) => {
      pushed.push({ baseUrl, syncId });
    };
  });

  /**
   * The row deleted on the remote is untouched locally, so it is absent from
   * the incremental window on both sides -- the shape every ordinary deletion
   * takes once the two sides have converged.
   */
  function stubSides(localHolds: string[], remoteTombstoneIds: string[]) {
    engine.pullSide = async (baseUrl, _token, _entityType, since) => {
      if (since) return [];
      fullPulls.push(baseUrl);
      return baseUrl === REMOTE
        ? []
        : localHolds.map((syncId) => ({ syncId, updatedAt: CURSOR }));
    };
    engine.pullTombstones = async (baseUrl) =>
      baseUrl === REMOTE
        ? remoteTombstoneIds.map((syncId) => ({ syncId }))
        : [];
  }

  it("applies a remote deletion to a local row that is outside the incremental window", async () => {
    stubSides(["cred-1"], ["cred-1"]);

    await engine.syncEntity({
      entityType: "sshCredentials",
      remoteBaseUrl: REMOTE,
      remoteJwt: "remote-jwt",
      since: CURSOR,
    });

    expect(pushed).toEqual([
      { baseUrl: "http://127.0.0.1:30001", syncId: "cred-1" },
    ]);
  });

  it("does not re-push a deletion once the row is gone, so tombstones cannot ping-pong", async () => {
    stubSides([], ["cred-1"]);

    await engine.syncEntity({
      entityType: "sshCredentials",
      remoteBaseUrl: REMOTE,
      remoteJwt: "remote-jwt",
      since: CURSOR,
    });

    expect(pushed).toEqual([]);
  });

  it("does not pay for a presence check when nothing was deleted", async () => {
    stubSides(["cred-1"], []);

    await engine.syncEntity({
      entityType: "sshCredentials",
      remoteBaseUrl: REMOTE,
      remoteJwt: "remote-jwt",
      since: CURSOR,
    });

    expect(pushed).toEqual([]);
    expect(fullPulls).toEqual([]);
  });
});
