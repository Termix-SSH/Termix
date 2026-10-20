import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const index = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../../plugins/bundled-index.js", () => ({
  defaultLookPluginIds: () => index.ids,
}));

import {
  installedLayoutIds,
  resolveDefaultLook,
  safeLayoutForced,
  unavailableLooks,
} from "../../plugins/looks.js";
import type { SkippedPlugin } from "../../plugins/loader.js";

type Contributes = Record<string, unknown>;

function loaderWith(
  plugins: Record<string, Contributes>,
  skipped: SkippedPlugin[] = [],
) {
  return {
    get: (id: string) =>
      plugins[id]
        ? ({ manifest: { contributes: plugins[id] } } as never)
        : undefined,
    list: () =>
      Object.values(plugins).map(
        (contributes) => ({ manifest: { contributes } }) as never,
      ),
    skipped: () => skipped,
  };
}

beforeEach(() => {
  index.ids = [];
});
afterEach(() => {
  delete process.env.TERMIX_SAFE_LAYOUT;
});

describe("resolveDefaultLook", () => {
  it("is empty without a default-look plugin", () => {
    expect(resolveDefaultLook(loaderWith({}))).toEqual({
      layout: null,
      theme: null,
    });
  });

  it("takes the layout marked default and its theme", () => {
    index.ids = ["look-a"];
    const loader = loaderWith({
      "look-a": {
        layouts: [
          { id: "first", label: "First", defaultTheme: "one" },
          { id: "main", label: "Main", defaultTheme: "two", default: true },
        ],
      },
    });
    expect(resolveDefaultLook(loader)).toEqual({
      layout: "main",
      theme: "two",
    });
  });

  it("takes the first layout, and a theme from a themes-only plugin", () => {
    index.ids = ["look-a", "look-b"];
    const loader = loaderWith({
      "look-a": { themes: [{ id: "paper", label: "Paper" }] },
      "look-b": { layouts: [{ id: "solo", label: "Solo" }] },
    });
    expect(resolveDefaultLook(loader)).toEqual({
      layout: "solo",
      theme: "paper",
    });
  });

  it("skips a default-look plugin that did not load", () => {
    index.ids = ["gone"];
    expect(resolveDefaultLook(loaderWith({}))).toEqual({
      layout: null,
      theme: null,
    });
  });
});

describe("unavailableLooks", () => {
  it("lists only skipped plugins that brought a layout or theme", () => {
    const skipped: SkippedPlugin[] = [
      { id: "a", version: "1.0.0", layouts: ["x"], themes: [], error: "e" },
      { id: "b", version: null, layouts: [], themes: [], error: "e" },
      { id: "c", version: "2.0.0", layouts: [], themes: ["t"], error: "e" },
    ];
    expect(
      unavailableLooks(loaderWith({}, skipped)).map((plugin) => plugin.id),
    ).toEqual(["a", "c"]);
  });
});

describe("safeLayoutForced", () => {
  it("reads TERMIX_SAFE_LAYOUT", () => {
    expect(safeLayoutForced()).toBe(false);
    process.env.TERMIX_SAFE_LAYOUT = "1";
    expect(safeLayoutForced()).toBe(true);
    process.env.TERMIX_SAFE_LAYOUT = "true";
    expect(safeLayoutForced()).toBe(true);
    process.env.TERMIX_SAFE_LAYOUT = "0";
    expect(safeLayoutForced()).toBe(false);
  });
});

describe("installedLayoutIds", () => {
  it("lists layouts of loaded and skipped plugins", () => {
    const ids = installedLayoutIds(
      loaderWith({ a: { layouts: [{ id: "one" }], themes: [{ id: "t" }] } }, [
        { id: "b", version: null, layouts: ["two"], themes: [], error: "x" },
      ]),
    );
    expect([...ids].sort()).toEqual(["one", "two"]);
  });
});
