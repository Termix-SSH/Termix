import { describe, expect, it } from "vitest";
import {
  estimateIncompressibleSample,
  resolveArchiveTransferMethod,
  type TransferScanSummary,
} from "../../../hosts/file-manager/transfer-routing.js";

describe("transfer content sampling", () => {
  it("recognizes repetitive content as compressible", () => {
    expect(estimateIncompressibleSample(Buffer.alloc(64 * 1024, 65))).toBe(
      false,
    );
  });

  it("recognizes high-entropy content as incompressible", () => {
    const sample = Buffer.alloc(64 * 1024);
    let state = 0x12345678;
    for (let i = 0; i < sample.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      sample[i] = state & 0xff;
    }
    expect(estimateIncompressibleSample(sample)).toBe(true);
  });

  it("prefers sampled content over a misleading extension", () => {
    const summary: TransferScanSummary = {
      fileCount: 120,
      totalBytes: 1024 * 1024 * 1024,
      largestFileBytes: 32 * 1024 * 1024,
      incompressibleRatio: 0,
      sampledIncompressibleRatio: 1,
    };
    expect(
      resolveArchiveTransferMethod("auto", summary, "unix", "unix", true, true),
    ).toBe("item_sftp");
  });
});
