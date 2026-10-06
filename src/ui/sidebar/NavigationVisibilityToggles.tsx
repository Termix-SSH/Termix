import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { FakeSwitch } from "@/components/section-card";
import { Button } from "@/components/button";
import {
  useAreaPreferences,
  useUiPreferencesContext,
} from "@/contexts/UiPreferencesContext";
import { moveRailItem, useRailItems } from "./rail-items";

/**
 * Appearance > Sidebar > Navigation: one switch per rail destination,
 * including the ones plugins register, which appear and disappear here as
 * their plugin is turned on and off. The arrows reorder the rail.
 */
export function NavigationVisibilityToggles({
  hidden,
  onChange,
}: {
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const railItems = useRailItems();
  const uiPrefs = useUiPreferencesContext();
  const { order } = useAreaPreferences("rail");
  const main = railItems.filter((item) => item.placement !== "footer");
  const band = (id: string) =>
    main.find((item) => item.id === id)?.group ?? "tools";

  const move = (id: string, direction: -1 | 1) => {
    const peers = main.filter((item) => band(item.id) === band(id));
    const at = peers.findIndex((item) => item.id === id);
    const target = at + direction;
    if (target < 0 || target >= peers.length) return;
    // Moving down means sitting before the item after the next one.
    const before =
      direction === -1 ? peers[target].id : (peers[target + 1]?.id ?? null);
    uiPrefs?.setOverride("rail", "order", moveRailItem(main, id, before));
  };

  return (
    <>
      {railItems
        .filter((item) => item.hideable !== false)
        .map((item) => {
          const reorderable = item.placement !== "footer" && !!uiPrefs;
          const peers = main.filter((peer) => band(peer.id) === band(item.id));
          const index = peers.findIndex((peer) => peer.id === item.id);
          return (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 py-1.5"
              data-testid={`nav-toggle-${item.id}`}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
                <span className="text-muted-foreground">
                  <item.icon size={12} />
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {reorderable && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={index <= 0}
                      title={t("nav.moveUp")}
                      aria-label={t("nav.moveUp")}
                      onClick={() => move(item.id, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={index < 0 || index >= peers.length - 1}
                      title={t("nav.moveDown")}
                      aria-label={t("nav.moveDown")}
                      onClick={() => move(item.id, 1)}
                    >
                      <ChevronDown />
                    </Button>
                  </>
                )}
                <FakeSwitch
                  checked={!hidden.has(item.id)}
                  onChange={(visible) => {
                    const next = new Set(hidden);
                    if (visible) next.delete(item.id);
                    else next.add(item.id);
                    onChange(next);
                  }}
                />
              </span>
            </div>
          );
        })}
      {uiPrefs && order && order.length > 0 && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 self-start text-muted-foreground"
          onClick={() => uiPrefs.setOverride("rail", "order", null)}
        >
          <RotateCcw />
          {t("nav.resetRailOrder")}
        </Button>
      )}
    </>
  );
}
