import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { windowsLinuxMenuTemplate } =
  require("../../../../electron/keyboard-shortcuts.cjs") as {
    windowsLinuxMenuTemplate: () => Array<{
      submenu: Array<{ role?: string; accelerator?: string }>;
    }>;
  };

const items = () => windowsLinuxMenuTemplate().flatMap((menu) => menu.submenu);

describe("the Windows and Linux app menu", () => {
  it("has no Close, so Ctrl+W reaches the page", () => {
    expect(items().map((item) => item.role)).not.toContain("close");
    expect(items().some((item) => /w$/i.test(item.accelerator ?? ""))).toBe(
      false,
    );
  });

  it("keeps the usual keys like reload, zoom and DevTools", () => {
    expect(items().map((item) => item.role)).toEqual(
      expect.arrayContaining([
        "reload",
        "toggleDevTools",
        "zoomIn",
        "copy",
        "paste",
      ]),
    );
  });
});
