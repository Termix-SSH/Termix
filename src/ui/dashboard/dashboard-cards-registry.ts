import type { ReactNode } from "react";

/**
 * Runtime registry for plugin-contributed dashboard cards.
 *
 * Unlike registerRailItem/registerTabComponent (rail-items.ts, tabUtils.tsx),
 * nothing in DashboardTab.tsx consumes this yet: its card system
 * (DASHBOARD_CARDS in @/lib/theme, DashboardCardId in @/types/ui-types) is a
 * closed, typed set with its own drag/drop layout and per-user persisted
 * slot preferences, and no plugin today contributes an actual dashboard
 * card. This registry exists so a plugin CAN register one without another
 * round of seam-building, but adding it to the DashboardTab render/layout
 * system is future work, not part of this change.
 */
export interface RegisteredDashboardCard {
  id: string;
  titleKey: string;
  render: () => ReactNode;
}

const registeredDashboardCards = new Map<string, RegisteredDashboardCard>();

export function registerDashboardCard(def: RegisteredDashboardCard): void {
  registeredDashboardCards.set(def.id, def);
}

export function unregisterDashboardCard(id: string): void {
  registeredDashboardCards.delete(id);
}

export function registeredDashboardCardList(): RegisteredDashboardCard[] {
  return [...registeredDashboardCards.values()];
}
