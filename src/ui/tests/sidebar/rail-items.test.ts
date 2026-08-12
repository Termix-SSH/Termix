import { describe, expect, it } from "vitest";
import {
  HIDEABLE_RAIL_IDS,
  RAIL_ITEMS,
  RAIL_UTILITY_ITEMS,
  railItemLabel,
} from "@/sidebar/rail-items";
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
});

describe("railItemLabel", () => {
  it("translates known destinations", () => {
    expect(railItemLabel("hosts", () => "Hosts")).toBe("Hosts");
  });

  it("falls back to the id for anything unknown", () => {
    expect(railItemLabel("not-a-view", (k) => k)).toBe("not-a-view");
  });
});
