import { useTranslation } from "react-i18next";
import { FakeSwitch } from "@/components/section-card";
import { useRailItems } from "./rail-items";

/**
 * Appearance > Sidebar > Navigation: one switch per rail destination,
 * including the ones plugins register, which appear and disappear here as
 * their plugin is turned on and off.
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

  return (
    <>
      {railItems
        .filter((item) => item.hideable !== false)
        .map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between py-1.5"
            data-testid={`nav-toggle-${item.id}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="text-muted-foreground">
                <item.icon size={12} />
              </span>
              {t(item.labelKey)}
            </span>
            <FakeSwitch
              checked={!hidden.has(item.id)}
              onChange={(visible) => {
                const next = new Set(hidden);
                if (visible) next.delete(item.id);
                else next.add(item.id);
                onChange(next);
              }}
            />
          </div>
        ))}
    </>
  );
}
