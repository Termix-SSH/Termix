import { afterEach, describe, expect, it, vi } from "vitest";

const registered = vi.hoisted(() => ({
  cards: new Map<
    string,
    { defaultHeight?: number; defaultPanel?: "main" | "side" }
  >(),
}));

vi.mock("@/dashboard/dashboard-cards-registry", () => ({
  getRegisteredDashboardCard: (id: string) => registered.cards.get(id),
}));

const { buildDashboardSlots, presetHiddenRailTabs } =
  await import("../../lib/apply-ui-preset.js");

afterEach(() => {
  registered.cards.clear();
});

describe("buildDashboardSlots", () => {
  it("places core cards in the main panel by default", () => {
    const slots = buildDashboardSlots(["stats_bar", "quick_actions"]);
    expect(slots.map((s) => s.panel)).toEqual(["main", "main"]);
    expect(slots.map((s) => s.height)).toEqual([96, 160]);
  });

  it("keeps recent_activity in the side panel", () => {
    const slots = buildDashboardSlots(["stats_bar", "recent_activity"]);
    expect(slots.find((s) => s.id === "recent_activity")?.panel).toBe("side");
  });

  it("reads a plugin card's own height and panel from the registry", () => {
    registered.cards.set("service_links", {
      defaultHeight: 200,
      defaultPanel: "side",
    });
    const slots = buildDashboardSlots(["stats_bar", "service_links"]);
    const link = slots.find((s) => s.id === "service_links");
    expect(link?.panel).toBe("side");
    expect(link?.height).toBe(200);
  });

  it("defaults an unregistered plugin card to the main panel with no fixed height", () => {
    const slots = buildDashboardSlots(["some_plugin_card"]);
    expect(slots).toEqual([
      {
        key: "some_plugin_card_0",
        id: "some_plugin_card",
        panel: "main",
        order: 0,
        height: null,
      },
    ]);
  });

  it("orders main and side cards independently", () => {
    registered.cards.set("service_links", { defaultPanel: "side" });
    const slots = buildDashboardSlots([
      "stats_bar",
      "service_links",
      "quick_actions",
      "recent_activity",
    ]);
    expect(slots.map((s) => [s.id, s.panel, s.order])).toEqual([
      ["stats_bar", "main", 0],
      ["service_links", "side", 0],
      ["quick_actions", "main", 1],
      ["recent_activity", "side", 1],
    ]);
  });
});

describe("presetHiddenRailTabs", () => {
  const items = [
    { id: "snippets", simplePreset: true },
    { id: "docker-like" },
    { id: "pinned", hideable: false },
  ];

  it("hides plugin items that do not opt in when the preset asks", () => {
    expect(
      presetHiddenRailTabs(
        { hiddenTabs: ["macros"], hidePluginItems: true },
        items,
      ),
    ).toEqual(["macros", "docker-like"]);
  });

  it("leaves plugin items alone otherwise", () => {
    expect(presetHiddenRailTabs({ hiddenTabs: [] }, items)).toEqual([]);
  });
});
