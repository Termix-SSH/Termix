import { afterEach, describe, expect, it } from "vitest";
import { Boxes } from "lucide-react";
import {
  hideableRailIds,
  permittedRailItems,
  promotableIds,
  RAIL_ITEMS,
  RAIL_UTILITY_ITEMS,
  registerRailItem,
  resetRegisteredRailItems,
  rightDockableIds,
  railItemLabel,
  visibleRailItems,
} from "@/sidebar/rail-items";
import { isCapturableTabType } from "@/shell/shell-layout";
import en from "@/locales/en.json";

afterEach(() => resetRegisteredRailItems());

function lookup(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      en,
    );
}

describe("RAIL_ITEMS", () => {
  it("has no duplicate ids", () => {
    const ids = [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every destination a real translation key", () => {
    for (const item of [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]) {
      expect(
        typeof lookup(item.labelKey),
        `missing translation for ${item.id} (${item.labelKey})`,
      ).toBe("string");
    }
  });

  it("keeps the destinations that shipped before the lists were merged", () => {
    // Guards against a destination silently disappearing now that the rail,
    // the settings toggles, the sidebar titles and the mobile bar all read
    // from this one list.
    // "sftp" moved to the file-manager plugin's own registerRailItem, and
    // "port-forwarding" to the tunnels plugin's.
    expect(RAIL_ITEMS.map((item) => item.id)).toEqual([
      "hosts",
      "credentials",
      "termix-id",
      "connections",
      "collab",
      "quick-connect",
      "serial",
      "ssh-tools",
      "macros",
      "session-logs",
      "split-screen",
    ]);
  });

  it("exposes every visible rail item as hideable", () => {
    expect(hideableRailIds()).toEqual(
      visibleRailItems().map((item) => item.id),
    );
  });

  it("marks exactly the three mobile primary slots", () => {
    expect(
      RAIL_ITEMS.filter((item) => item.mobilePrimary).map((item) => item.id),
    ).toEqual(["hosts", "quick-connect", "ssh-tools"]);
  });

  it("marks the panels that can open as a tab", () => {
    expect(
      [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
        .filter((item) => item.promotable)
        .map((item) => item.id),
    ).toEqual(["termix-id", "ssh-tools", "macros", "session-logs"]);
  });

  it("derives promotableIds from the promotable flag", () => {
    // The header button and the hint both gate on this list, so a drift here
    // silently hides the feature for that panel.
    expect(promotableIds()).toEqual(
      [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
        .filter((item) => item.promotable)
        .map((item) => item.id),
    );
  });

  it("every promotable id is also a captured workspace tab type", () => {
    // The id doubles as the TabType, so a promoted panel that isn't capturable
    // would silently vanish from saved workspaces.
    for (const item of [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]) {
      if (!item.promotable) continue;
      expect(
        isCapturableTabType(item.id),
        `${item.id} is promotable but not workspace-capturable`,
      ).toBe(true);
    }
  });

  it("keeps the mounted-but-hidden panels out of the right dock", () => {
    // Hosts, credentials and fleets stay mounted while hidden and share editing
    // state, so a second live instance in the right dock would fight the first.
    for (const id of ["hosts", "credentials"]) {
      expect(
        rightDockableIds(),
        `${id} must not be right-dockable`,
      ).not.toContain(id);
    }
  });

  it("only offers reference panels in the right dock", () => {
    expect(rightDockableIds()).toEqual([
      "connections",
      "ssh-tools",
      "macros",
      "session-logs",
    ]);
  });
});

describe("registered rail items", () => {
  const item = (id: string, extra: object = {}) => ({
    id,
    icon: Boxes,
    labelKey: `nav.${id}`,
    pluginId: "p",
    ...extra,
  });

  it("places items after their anchor, keeping their own order", () => {
    registerRailItem(item("second", { after: "macros", order: 2 }));
    registerRailItem(item("first", { after: "macros", order: 1 }));
    const ids = visibleRailItems().map((entry) => entry.id);
    const at = ids.indexOf("macros");
    expect(ids.slice(at + 1, at + 3)).toEqual(["first", "second"]);
  });

  it("goes to the end when its anchor does not exist", () => {
    registerRailItem(item("orphan", { after: "nowhere" }));
    expect(visibleRailItems().at(-1)?.id).toBe("orphan");
  });

  it("feeds its flags into the promotable, dock and hideable lists", () => {
    registerRailItem(item("docked", { promotable: true, rightDockable: true }));
    registerRailItem(item("pinned", { hideable: false }));
    expect(promotableIds()).toContain("docked");
    expect(rightDockableIds()).toContain("docked");
    expect(hideableRailIds()).toContain("docked");
    expect(hideableRailIds()).not.toContain("pinned");
  });

  it("drops a hidden item everywhere without unregistering it", () => {
    registerRailItem(item("off", { hidden: true, promotable: true }));
    expect(visibleRailItems().map((entry) => entry.id)).not.toContain("off");
    expect(hideableRailIds()).not.toContain("off");
    expect(promotableIds()).not.toContain("off");
  });

  it("labels a registered item by its own key", () => {
    registerRailItem(item("labelled"));
    expect(railItemLabel("labelled", (key) => `t:${key}`)).toBe(
      "t:nav.labelled",
    );
  });

  it("disposes only the entry it registered", () => {
    const dispose = registerRailItem(item("same", { order: 1 }));
    registerRailItem(item("same", { order: 2 }));
    dispose();
    expect(visibleRailItems().map((entry) => entry.id)).toContain("same");
  });
});

describe("railItemLabel", () => {
  it("translates known destinations", () => {
    expect(railItemLabel("hosts", () => "Hosts")).toBe("Hosts");
  });

  it("falls back to the id for anything unknown", () => {
    expect(railItemLabel("not-a-view", (k) => k)).toBe("not-a-view");
  });

  describe("electron-only items", () => {
    afterEach(() => {
      delete (window as { IS_ELECTRON?: boolean }).IS_ELECTRON;
    });

    const desktopOnly = {
      id: "desktop-only",
      icon: Boxes,
      labelKey: "nav.desktopOnly",
      pluginId: "p",
      electronOnly: true,
    };

    it("hides electron-only destinations in the browser build", () => {
      const dispose = registerRailItem(desktopOnly);
      const ids = visibleRailItems().map((item) => item.id);
      dispose();
      expect(ids).not.toContain("desktop-only");
    });

    it("shows electron-only destinations in the desktop app", () => {
      (window as { IS_ELECTRON?: boolean }).IS_ELECTRON = true;
      const dispose = registerRailItem(desktopOnly);
      const ids = visibleRailItems().map((item) => item.id);
      dispose();
      expect(ids).toContain("desktop-only");
    });

    it("keeps every non-electron item in both builds", () => {
      const browser = visibleRailItems().map((item) => item.id);
      (window as { IS_ELECTRON?: boolean }).IS_ELECTRON = true;
      const desktop = visibleRailItems().map((item) => item.id);
      const electronOnly = RAIL_ITEMS.filter((item) => item.electronOnly).map(
        (item) => item.id,
      );
      expect(desktop.filter((id) => !electronOnly.includes(id))).toEqual(
        browser,
      );
    });
  });
});

describe("permittedRailItems", () => {
  const items = [
    { id: "open", icon: Boxes, labelKey: "nav.hosts" },
    {
      id: "gated",
      icon: Boxes,
      labelKey: "nav.hosts",
      permission: "demo.use",
    },
  ];

  it("hides an item gated on a permission the user lacks", () => {
    const ids = permittedRailItems(items, {
      loaded: true,
      has: () => false,
    }).map((item) => item.id);
    expect(ids).toEqual(["open"]);
  });

  it("shows it once the user holds the permission", () => {
    const ids = permittedRailItems(items, {
      loaded: true,
      has: (permission) => permission === "demo.use",
    }).map((item) => item.id);
    expect(ids).toEqual(["open", "gated"]);
  });

  it("keeps gated items hidden until permissions have loaded", () => {
    const ids = permittedRailItems(items, {
      loaded: false,
      has: () => true,
    }).map((item) => item.id);
    expect(ids).toEqual(["open"]);
  });
});
