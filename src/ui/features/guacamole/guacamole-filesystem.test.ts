import { describe, expect, it } from "vitest";
import { describeUploadError } from "./guacamole-filesystem";

const t = (key: string) => `#${key}`;

describe("describeUploadError", () => {
  it("explains guacd's refusal to open the target file as a drive-folder problem", () => {
    expect(describeUploadError(new Error("FAIL (CANNOT OPEN)"), t)).toBe(
      "#driveNotWritable",
    );
    expect(describeUploadError(new Error("FAIL (NO FS)"), t)).toBe(
      "#driveUnavailable",
    );
  });

  it("passes other messages through and falls back for unknown errors", () => {
    expect(describeUploadError(new Error("disk full"), t)).toBe("disk full");
    expect(describeUploadError(undefined, t)).toBe("#uploadFailed");
  });
});
