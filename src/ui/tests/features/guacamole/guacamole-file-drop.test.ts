import { describe, expect, it } from "vitest";
import {
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
});
