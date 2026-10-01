import { afterEach, describe, expect, it } from "vitest";
import {
  filterPaletteItems,
  listPaletteGroups,
  loadPaletteGroup,
  registerPaletteGroup,
  resetPaletteGroups,
  type PaletteItemDef,
} from "../../shell/palette-registry";

afterEach(() => resetPaletteGroups());

const item = (
  id: string,
  title: string,
  extra: Partial<PaletteItemDef> = {},
): PaletteItemDef => ({ id, title, run: () => {}, ...extra });

describe("palette groups", () => {
  it("orders groups and loads their items", async () => {
    registerPaletteGroup({
      id: "b",
      titleKey: "b",
      order: 2,
      load: () => [item("1", "One")],
    });
    registerPaletteGroup({
      id: "a",
      titleKey: "a",
      order: 1,
      load: async () => [item("2", "Two")],
    });
    const groups = listPaletteGroups();
    expect(groups.map((group) => group.id)).toEqual(["a", "b"]);
    expect((await loadPaletteGroup(groups[0])).map((i) => i.id)).toEqual(["2"]);
  });

  it("answers no items when a loader throws", async () => {
    const group = {
      id: "broken",
      titleKey: "x",
      load: async () => {
        throw new Error("offline");
      },
    };
    expect(await loadPaletteGroup(group)).toEqual([]);
  });

  it("matches title, description and keywords, and hides items until typed", () => {
    const items = [
      item("1", "Restart nginx", { description: "systemctl restart" }),
      item("2", "Disk usage", { keywords: ["df"] }),
    ];
    expect(filterPaletteItems(items, "")).toEqual([]);
    expect(filterPaletteItems(items, "", true)).toEqual(items);
    expect(filterPaletteItems(items, "SYSTEMCTL").map((i) => i.id)).toEqual([
      "1",
    ]);
    expect(filterPaletteItems(items, "df").map((i) => i.id)).toEqual(["2"]);
  });
});
