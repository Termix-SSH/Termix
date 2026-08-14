import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTransferProfiles,
  getTransferProfile,
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
    expect(getTransferProfile("a->b", 25 * 60 * 60 * 1000)).toBeUndefined();
  });
});
