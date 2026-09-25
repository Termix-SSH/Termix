import { describe, expect, it } from "vitest";
import { validateAdminSettings } from "../../src/backend/settings-validation.js";

describe("validateAdminSettings", () => {
  it("rejects relative image paths", () => {
    expect(
      Object.keys(
        validateAdminSettings({
          imageLocalDir: "images",
          imageHostPath: "tmp/images",
        }),
      ).sort(),
    ).toEqual(["imageHostPath", "imageLocalDir"]);
  });

  it("accepts absolute paths and empty values", () => {
    expect(
      validateAdminSettings({ imageLocalDir: "", imageHostPath: "/tmp/img" }),
    ).toEqual({});
  });
});
