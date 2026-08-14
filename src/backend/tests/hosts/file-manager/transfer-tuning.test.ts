import { beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearTransferProfiles,
  flushTransferProfiles,
  getTransferProfile,
  initializeTransferProfiles,
  recordTransferProfile,
  selectTransferTuning,
  updateTransferProfile,
} from "../../../hosts/file-manager/transfer-tuning.js";

const MB = 1024 * 1024;

describe("adaptive transfer tuning", () => {
  beforeEach(clearTransferProfiles);

  it("keeps small files on one conservative lane", () => {
    expect(selectTransferTuning(8 * MB)).toEqual({
      parallelSegmentCount: 1,
      pipelineConcurrency: 8,
    });
  });

  it("uses more lanes for large transfers without exceeding segment count", () => {
    expect(selectTransferTuning(2 * 1024 * MB)).toEqual({
      parallelSegmentCount: 4,
      pipelineConcurrency: 32,
    });
    expect(selectTransferTuning(300 * MB).parallelSegmentCount).toBe(2);
  });

  it("honours an explicit lane selection", () => {
    expect(selectTransferTuning(2 * 1024 * MB, undefined, 3)).toMatchObject({
      parallelSegmentCount: 3,
    });
  });

  it("backs off after failures", () => {
    const profile = updateTransferProfile(undefined, {
      bytes: 256 * MB,
      durationMs: 1000,
      lanes: 4,
      pipelineConcurrency: 32,
      failed: true,
      now: 1,
    });
    expect(profile.preferredLanes).toBe(2);
    expect(profile.pipelineConcurrency).toBe(16);
  });

  it("learns and expires host-pair profiles", () => {
    recordTransferProfile("a->b", {
      bytes: 256 * MB,
      durationMs: 2000,
      lanes: 2,
      pipelineConcurrency: 32,
      failed: false,
      now: 100,
    });
    expect(getTransferProfile("a->b", 101)?.samples).toBe(1);
    expect(getTransferProfile("a->b", 8 * 24 * 60 * 60 * 1000)).toBeUndefined();
  });

  it("persists only anonymous local profiles across restarts", async () => {
    const previousDataDir = process.env.DATA_DIR;
    const dataDir = await fs.mkdtemp(path.join(tmpdir(), "termix-transfer-"));
    process.env.DATA_DIR = dataDir;
    const rawKey = "root@10.0.0.1->deploy@10.0.0.2";
    const now = Date.now();

    try {
      await initializeTransferProfiles();
      recordTransferProfile(rawKey, {
        bytes: 256 * MB,
        durationMs: 2000,
        lanes: 2,
        pipelineConcurrency: 16,
        failed: false,
        now,
      });
      await flushTransferProfiles();

      const stored = await fs.readFile(
        path.join(dataDir, "adaptive-transfer-profiles.json"),
        "utf8",
      );
      expect(stored).not.toContain(rawKey);
      expect(Object.keys(JSON.parse(stored).profiles)[0]).toMatch(
        /^[a-f0-9]{64}$/,
      );

      clearTransferProfiles();
      await initializeTransferProfiles();
      expect(getTransferProfile(rawKey, now + 1)).toMatchObject({ samples: 1 });
    } finally {
      clearTransferProfiles();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
