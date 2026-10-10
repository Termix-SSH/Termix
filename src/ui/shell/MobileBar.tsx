/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LogOut,
  MoreHorizontal,
  Search,
  Settings,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import type { TabType } from "@/types/ui-types";
import type { RailView } from "@/sidebar/AppRail";
import {
  groupRailItems,
  useRailItems,
  type RailItemDef,
} from "@/sidebar/rail-items";
import { useHiddenRailTabs } from "@/sidebar/hidden-rail-tabs";
import { RailBadge } from "@/sidebar/RailBadge";
import { cn } from "@/lib/utils";
import { isElectron } from "@/lib/electron";

const PRIMARY_COUNT = 4;

/** The four bar slots: flagged items first, then the rest in rail order. */
export function pickPrimaryItems(items: RailItemDef[]): RailItemDef[] {
  const usable = items.filter((item) => item.kind !== "tab");
  return [
    ...usable.filter((item) => item.mobilePrimary),
    ...usable.filter((item) => !item.mobilePrimary),
  ].slice(0, PRIMARY_COUNT);
}

/**
 * The rail on a phone: the most used destinations on the bar, everything else
 * in a sheet behind More with search, settings and logout.
 */
export function MobileBar({
  railView,
  sidebarOpen,
  username,
  onRailClick,
  onOpenTab,
  onOpenSettings,
  onOpenPalette,
  onLogout,
}: {
  railView: RailView;
  sidebarOpen: boolean;
  username: string;
  onRailClick: (view: RailView) => void;
  onOpenTab: (type: TabType) => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const railItems = useRailItems();
  const hidden = useHiddenRailTabs();

  const visible = useMemo(
    () => railItems.filter((item) => !hidden.has(item.id)),
    [railItems, hidden],
  );
  const main = visible.filter((item) => item.placement !== "footer");
  const footer = visible.filter((item) => item.placement === "footer");
  const primary = useMemo(() => pickPrimaryItems(main), [main]);
  const bands = useMemo(() => groupRailItems(main), [main]);
  const badged = footer.find((item) => item.useBadge);

  const close = () => setMoreOpen(false);
  const open = (item: RailItemDef) => {
    close();
    if (item.kind === "tab") onOpenTab(item.id as TabType);
    else onRailClick(item.id as RailView);
  };

  return (
    <>
      <nav
        aria-label={t("nav.mobileNavigation")}
        className="flex shrink-0 items-stretch border-t border-border bg-sidebar safe-bottom md:hidden"
      >
        {primary.map((item) => (
          <BarButton
            key={item.id}
            icon={item.icon}
            label={t(item.labelKey)}
            active={sidebarOpen && railView === item.id}
            useBadge={item.useBadge}
            onClick={() => open(item)}
          />
        ))}
        <BarButton
          icon={MoreHorizontal}
          label={t("common.more")}
          active={moreOpen}
          useBadge={badged?.useBadge}
          onClick={() => setMoreOpen(true)}
        />
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col justify-end md:hidden">
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute inset-0 bg-overlay"
            onClick={close}
          />
          <div
            role="dialog"
            aria-label={t("common.more")}
            className="motion-panel-enter relative flex max-h-[80dvh] flex-col border-t border-border bg-sidebar safe-bottom"
          >
            <div className="flex h-12.5 shrink-0 items-center border-b border-border px-3">
              <span className="flex-1 text-base font-bold tracking-tight text-foreground">
                {t("common.more")}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label={t("common.close")}
                className="flex size-9 items-center justify-center text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-2">
              <SheetRow
                icon={Search}
                label={t("nav.search")}
                onClick={() => {
                  close();
                  onOpenPalette();
                }}
              />
              {bands.map((band) => (
                <div key={band.group} className="mt-1 flex flex-col">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {t(`nav.group.${band.group}`)}
                  </div>
                  {band.items.map((item) => (
                    <SheetRow
                      key={item.id}
                      icon={item.icon}
                      label={t(item.labelKey)}
                      useBadge={item.useBadge}
                      active={sidebarOpen && railView === item.id}
                      onOpenAsTab={
                        item.promotable
                          ? () => {
                              close();
                              onOpenTab(item.id as TabType);
                            }
                          : undefined
                      }
                      onClick={() => open(item)}
                    />
                  ))}
                </div>
              ))}

              <div className="mt-2 border-t border-border pt-2">
                {footer.map((item) => (
                  <SheetRow
                    key={item.id}
                    icon={item.icon}
                    label={t(item.labelKey)}
                    useBadge={item.useBadge}
                    active={sidebarOpen && railView === item.id}
                    onClick={() => open(item)}
                  />
                ))}
                <SheetRow
                  icon={Settings}
                  label={t("nav.settings")}
                  hint={username}
                  onClick={() => {
                    close();
                    onOpenSettings();
                  }}
                />
                {!isElectron() && (
                  <SheetRow
                    icon={LogOut}
                    label={t("common.logout")}
                    onClick={() => {
                      close();
                      onLogout();
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BarButton({
  icon: Icon,
  label,
  active,
  useBadge,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  useBadge?: () => number | null | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={!!active}
      className={cn(
        "relative flex h-14 flex-1 flex-col items-center justify-center gap-1 transition-colors",
        active
          ? "bg-accent-brand/10 text-accent-brand"
          : "text-muted-foreground active:bg-muted/60",
      )}
    >
      <span className="relative flex items-center justify-center">
        <Icon className="size-5" />
        {useBadge && (
          <RailBadge useBadge={useBadge} className="-right-2.5 -top-1.5" />
        )}
      </span>
      <span className="max-w-full truncate px-1 text-[10px] font-medium leading-none">
        {label}
      </span>
    </button>
  );
}

function SheetRow({
  icon: Icon,
  label,
  hint,
  useBadge,
  active,
  onClick,
  onOpenAsTab,
}: {
  icon: React.ElementType;
  label: string;
  hint?: string;
  useBadge?: () => number | null | undefined;
  active?: boolean;
  onClick: () => void;
  onOpenAsTab?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex min-h-11 flex-1 items-center gap-3 border-l-2 px-3 text-left transition-colors",
          active
            ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
            : "border-transparent text-foreground active:bg-muted",
        )}
      >
        <span className="relative flex shrink-0">
          <Icon className="size-4 text-muted-foreground" />
          {useBadge && (
            <RailBadge useBadge={useBadge} className="-right-2 -top-1.5" />
          )}
        </span>
        <span className="flex-1 truncate text-sm font-medium">{label}</span>
        {hint && (
          <span className="shrink-0 truncate text-[11px] text-muted-foreground">
            {hint}
          </span>
        )}
      </button>
      {onOpenAsTab && (
        <button
          type="button"
          onClick={onOpenAsTab}
          aria-label={t("nav.openAsTab")}
          title={t("nav.openAsTab")}
          className="flex w-11 shrink-0 items-center justify-center text-muted-foreground active:bg-muted"
        >
          <SquareArrowOutUpRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}
