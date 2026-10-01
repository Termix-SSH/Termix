import { describe, expect, it } from "vitest";
import {
  validateAdminSettings,
  validateUserSettings,
} from "../../src/backend/settings-validation.js";

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

describe("validateUserSettings", () => {
  const macro = { id: "m", name: "M", steps: [] };

  it("accepts bounded macros and a save without them", () => {
    expect(validateUserSettings({ macros: [macro] })).toEqual({});
    expect(validateUserSettings({ macros: JSON.stringify([macro]) })).toEqual(
      {},
    );
    expect(validateUserSettings({ localEcho: "on" })).toEqual({});
  });

  it("refuses malformed or too many macros", () => {
    expect(validateUserSettings({ macros: [{ id: 1 }] }).macros).toBeTruthy();
    expect(validateUserSettings({ macros: "{" }).macros).toBeTruthy();
    expect(
      validateUserSettings({
        macros: Array.from({ length: 101 }, (_, i) => ({
          ...macro,
          id: `${i}`,
        })),
      }).macros,
    ).toBeTruthy();
  });
});
