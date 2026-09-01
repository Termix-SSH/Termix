import { describe, expect, it } from "vitest";
import { buildImageUploadFormData } from "@/features/terminal/terminal-image-upload";

describe("buildImageUploadFormData", () => {
  it("tags a picked-file upload with source=file and a client timestamp", () => {
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });

    const form = buildImageUploadFormData(file, "tab-1", "file");

    expect(form.get("image")).toBe(file);
    expect(form.get("instanceId")).toBe("tab-1");
    expect(form.get("source")).toBe("file");
    const timestamp = form.get("clientUploadTimestamp");
    expect(typeof timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(timestamp as string))).toBe(false);
  });

  it("tags a clipboard upload with source=clipboard", () => {
    const file = new File(["png-bytes"], "clipboard-image.png", {
      type: "image/png",
    });

    const form = buildImageUploadFormData(file, "tab-1", "clipboard");

    expect(form.get("source")).toBe("clipboard");
  });

  it("uses the caller-provided client timestamp unchanged", () => {
    const file = new File(["png-bytes"], "photo.png", { type: "image/png" });

    const form = buildImageUploadFormData(
      file,
      "tab-1",
      "file",
      "2026-08-15T12:00:00.000Z",
    );

    expect(form.get("clientUploadTimestamp")).toBe("2026-08-15T12:00:00.000Z");
  });
});
