import { afterEach, describe, expect, it } from "vitest";
import {
  registerDashboardCard,
  registeredDashboardCardList,
  unregisterDashboardCard,
} from "@/dashboard/dashboard-cards-registry";

const FAKE_CARD_ID = "__test_plugin_dashboard_card__";

describe("registerDashboardCard seam", () => {
  afterEach(() => {
    unregisterDashboardCard(FAKE_CARD_ID);
  });

  it("is not registered by default", () => {
    expect(registeredDashboardCardList()).toEqual([]);
  });

  it("registers and unregisters a plugin dashboard card", () => {
    registerDashboardCard({
      id: FAKE_CARD_ID,
      titleKey: "nav.fakePluginItem",
      component: () => null,
    });

    expect(registeredDashboardCardList().map((c) => c.id)).toContain(
      FAKE_CARD_ID,
    );

    unregisterDashboardCard(FAKE_CARD_ID);

    expect(registeredDashboardCardList().map((c) => c.id)).not.toContain(
      FAKE_CARD_ID,
    );
  });
});
