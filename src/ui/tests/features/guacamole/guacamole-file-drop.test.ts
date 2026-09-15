import { describe, expect, it } from "vitest";
import {
  canUploadToRdpDrive,
  getFileDropDisposition,
  hasDraggedFiles,
} from "@/features/guacamole/guacamole-file-drop.ts";

describe("Guacamole file drop", () => {
  it("recognizes external file drags", () => {
    expect(hasDraggedFiles(["Files"])).toBe(true);
    expect(hasDraggedFiles(["text/plain"])).toBe(false);
  });

  it("rejects files when upload is unavailable instead of ignoring them", () => {
    expect(getFileDropDisposition(["Files"], 1, false)).toBe("reject");
    expect(getFileDropDisposition(["Files"], 1, true)).toBe("upload");
  });

  it("accepts an enabled RDP drive before a filesystem object is advertised", () => {
    expect(canUploadToRdpDrive(true, true, false)).toBe(true);
    expect(canUploadToRdpDrive(true, false, true)).toBe(true);
    expect(canUploadToRdpDrive(true, false, false)).toBe(false);
    expect(canUploadToRdpDrive(false, true, true)).toBe(false);
  });
});
