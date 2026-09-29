import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLBAR_SETTINGS,
  readToolbarSettings,
  toolbarAnchorClasses,
} from "../../../src/frontend/terminal/toolbar-settings";
import { toolbarPositionStorageKey } from "../../../src/frontend/terminal/toolbar-geometry";

const hostWith = (values: Record<string, unknown>) => ({
  pluginSettings: { "ssh-terminal": values },
});

describe("readToolbarSettings", () => {
  it("falls back to defaults for a host without settings", () => {
    expect(readToolbarSettings({})).toEqual(DEFAULT_TOOLBAR_SETTINGS);
    expect(readToolbarSettings(null)).toEqual(DEFAULT_TOOLBAR_SETTINGS);
  });

  it("reads saved values", () => {
    expect(
      readToolbarSettings(
        hostWith({
          terminalToolbarPosition: "top-left",
          terminalToolbarStartState: "collapsed",
          terminalToolbarDisplay: "expanded",
          terminalToolbarShowStatus: false,
          terminalToolbarFade: false,
        }),
      ),
    ).toEqual({
      anchor: "top-left",
      startCollapsed: true,
      density: "expanded",
      showStatus: false,
      fadeWhenIdle: false,
    });
  });

  it("ignores unknown values", () => {
    const settings = readToolbarSettings(
      hostWith({
        terminalToolbarPosition: "middle",
        terminalToolbarDisplay: "remember",
        terminalToolbarShowStatus: "no",
      }),
    );
    expect(settings.anchor).toBe("bottom");
    expect(settings.density).toBeNull();
    expect(settings.showStatus).toBe(true);
  });
});

describe("toolbar anchors", () => {
  it("maps anchors to flex placement", () => {
    expect(toolbarAnchorClasses("bottom")).toBe(
      "items-end pb-2 justify-center",
    );
    expect(toolbarAnchorClasses("top-left")).toBe(
      "items-start pt-2 justify-start pl-2",
    );
    expect(toolbarAnchorClasses("bottom-right")).toBe(
      "items-end pb-2 justify-end pr-2",
    );
  });

  it("keeps the original storage key for the bottom anchor", () => {
    expect(toolbarPositionStorageKey()).toBe(
      "termix-terminal-toolbar-position-v2",
    );
    expect(toolbarPositionStorageKey("top")).toBe(
      "termix-terminal-toolbar-position-v2-top",
    );
  });
});
