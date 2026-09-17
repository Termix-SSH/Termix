import { describe, expect, it } from "vitest";
import {
  hasSameHostTransferConflict,
  joinRemotePath,
  normalizeRemoteDir,
} from "@/features/sftp/sftp-transfer-utils";

describe("sftp transfer utilities", () => {
  it("normalizes and joins remote paths", () => {
    expect(normalizeRemoteDir(" /home/user// ")).toBe("/home/user");
    expect(joinRemotePath("/home/user/", "docs/readme.md")).toBe(
      "/home/user/docs/readme.md",
    );
    expect(joinRemotePath("/", "tmp/file.txt")).toBe("/tmp/file.txt");
    expect(joinRemotePath("home/user", "logs")).toBe("/home/user/logs");
  });

  it("detects same-host destination conflicts", () => {
    expect(hasSameHostTransferConflict(["/opt/app"], "/opt/app")).toBe(true);
    expect(hasSameHostTransferConflict(["/opt/app"], "/opt/app/logs")).toBe(
      true,
    );
    expect(hasSameHostTransferConflict(["/opt/app"], "/opt/releases")).toBe(
      false,
    );
  });
});
