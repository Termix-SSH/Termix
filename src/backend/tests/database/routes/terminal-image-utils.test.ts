import { describe, expect, it } from "vitest";
import { imageExtensionForFormat } from "../../../database/routes/terminal-image-utils.js";

describe("terminal image utilities", () => {
  it("maps decoded raster formats while excluding SVG", () => {
    expect(imageExtensionForFormat("jpeg")).toBe("jpg");
    expect(imageExtensionForFormat("heif")).toBe("heif");
    expect(imageExtensionForFormat("tiff")).toBe("tiff");
    expect(imageExtensionForFormat("svg")).toBeUndefined();
    expect(imageExtensionForFormat(undefined)).toBeUndefined();
  });
});
