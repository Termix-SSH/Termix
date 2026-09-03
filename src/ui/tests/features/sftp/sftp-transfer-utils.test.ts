import { describe, expect, it } from "vitest";
import {
  buildLocalUploadTargets,
  getRequiredRemoteDirectories,
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

  it("preserves relative local folder paths in upload targets", () => {
    const targets = buildLocalUploadTargets(
      [
        {
          path: "/Users/me/project/README.md",
          name: "README.md",
          relativePath: "project/README.md",
          size: 12,
        },
        {
          path: "/Users/me/project/src/index.ts",
          name: "index.ts",
          relativePath: "project/src/index.ts",
          size: 34,
        },
      ],
      "/var/www/",
    );

    expect(targets).toMatchObject([
      {
        remoteDir: "/var/www/project",
        fileName: "README.md",
        remotePath: "/var/www/project/README.md",
      },
      {
        remoteDir: "/var/www/project/src",
        fileName: "index.ts",
        remotePath: "/var/www/project/src/index.ts",
      },
    ]);
    expect(getRequiredRemoteDirectories(targets)).toEqual([
      "/var/www/project",
      "/var/www/project/src",
    ]);
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
