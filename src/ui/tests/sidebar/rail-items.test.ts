import { describe, expect, it } from "vitest";
import {
  HIDEABLE_RAIL_IDS,
  PROMOTABLE_IDS,
  RAIL_ITEMS,
  RAIL_UTILITY_ITEMS,
  RIGHT_DOCKABLE_IDS,
  railItemLabel,
} from "@/sidebar/rail-items";
import { WORKSPACE_CAPTURABLE_TYPES } from "@/shell/workspaceUtils";
import type { TabType } from "@/types/ui-types";
import en from "@/locales/en.json";

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
    expect(RAIL_ITEMS.map((item) => item.id)).toEqual([
      "hosts",
      "credentials",
      "termix-id",
      "connections",
      "quick-connect",
      "serial",
      "ssh-tools",
      "snippets",
      "fleets",
      "automations",
      "history",
      "session-logs",
      "split-screen",
      "workspaces",
      "network_graph",
    ]);
  });

  it("exposes every rail item as hideable", () => {
    expect(HIDEABLE_RAIL_IDS).toEqual(RAIL_ITEMS.map((item) => item.id));
  });

  it("marks exactly the four mobile primary slots", () => {
    expect(
      RAIL_ITEMS.filter((item) => item.mobilePrimary).map((item) => item.id),
    ).toEqual(["hosts", "quick-connect", "ssh-tools", "snippets"]);
  });

  it("marks the panels that can open as a tab", () => {
    expect(
      [...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
        .filter((item) => item.promotable)
        .map((item) => item.id),
    ).toEqual([
      "termix-id",
      "ssh-tools",
      "snippets",
      "automations",
      "history",
      "session-logs",
      "alerts",
    ]);
  });

  it("derives PROMOTABLE_IDS from the promotable flag", () => {
    // The header button and the hint both gate on this list, so a drift here
    // silently hides the feature for that panel.
    expect(PROMOTABLE_IDS).toEqual(
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
        WORKSPACE_CAPTURABLE_TYPES,
        `${item.id} is promotable but not workspace-capturable`,
      ).toContain(item.id as TabType);
    }
  });

  it("keeps the mounted-but-hidden panels out of the right dock", () => {
    // Hosts, credentials and fleets stay mounted while hidden and share editing
    // state, so a second live instance in the right dock would fight the first.
    for (const id of ["hosts", "credentials", "fleets"]) {
      expect(
        RIGHT_DOCKABLE_IDS,
        `${id} must not be right-dockable`,
      ).not.toContain(id);
    }
  });

  it("only offers reference panels in the right dock", () => {
    expect(RIGHT_DOCKABLE_IDS).toEqual([
      "connections",
      "ssh-tools",
      "snippets",
      "history",
      "session-logs",
      "alerts",
    ]);
  });
});

describe("railItemLabel", () => {
  it("translates known destinations", () => {
    expect(railItemLabel("hosts", () => "Hosts")).toBe("Hosts");
  });

  it("falls back to the id for anything unknown", () => {
    expect(railItemLabel("not-a-view", (k) => k)).toBe("not-a-view");
  });
});
