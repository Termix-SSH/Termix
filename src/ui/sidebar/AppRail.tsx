import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Eye,
  EyeOff,
  LogOut,
  PanelRight,
  Pin,
  Search,
  SlidersHorizontal,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { TabType, ToolsTab } from "@/types/ui-types";
import { Skeleton } from "@/components/skeleton";
import { readRailPreference, setRailPreference } from "./rail-preferences";
import {
  groupRailItems,
  moveRailItem,
  useRailItems,
  type RailGroup,
  type RailItemDef,
} from "./rail-items";
import { useUiPreferencesContext } from "@/contexts/UiPreferencesContext";
import { toggleHiddenRailTab, useHiddenRailTabs } from "./hidden-rail-tabs";
import { RailBadge } from "./RailBadge";
import { rem } from "@/lib/rem";
import { isElectron } from "@/lib/electron";

/** Core rail views; plugins add their own ids at runtime. */
export type CoreRailView =
  "hosts" | "credentials" | "quick-connect" | ToolsTab | "connections";

export type RailView = CoreRailView | (string & {});

const btnBase =
  "relative flex items-center h-7 shrink-0 transition-colors gap-2.5 focus-visible:ring-1 focus-visible:ring-ring";
const btnStyle = { margin: `0 ${rem(4)}`, padding: `0 ${rem(8)}` };
const idle = "text-muted-foreground hover:text-foreground hover:bg-muted/60";
const activeClass = "text-accent-brand bg-accent-brand/10";

function RailLabel({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`text-xs font-medium whitespace-nowrap overflow-hidden transition-[opacity,width] duration-150 ${
        expanded ? "opacity-100 delay-75" : "opacity-0 w-0"
      }`}
    >
      {children}
    </span>
  );
}

function RailIcon({
  children,
  useBadge,
}: {
  children: React.ReactNode;
  useBadge?: () => number | null | undefined;
}) {
  return (
    <span
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: rem(16), height: rem(16) }}
    >
      {children}
      {useBadge && (
        <RailBadge useBadge={useBadge} className="-top-1.5 -right-2" />
      )}
    </span>
  );
}

function Rule({ expanded }: { expanded: boolean }) {
  return (
    <div
      className="mx-auto h-px bg-border my-0.5 shrink-0 transition-[width] duration-200"
      style={{ width: expanded ? `calc(100% - ${rem(16)})` : rem(20) }}
    />
  );
}

/**
 * The band name rides on the divider between bands, so expanding the rail
 * never pushes items down from under the pointer.
 */
function GroupDivider({
  group,
  expanded,
}: {
  group: RailGroup;
  expanded: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="my-0.5 flex h-3 shrink-0 items-center gap-1.5 px-2.5">
      <span
        aria-hidden={!expanded}
        className={`shrink-0 overflow-hidden text-[10px] font-semibold uppercase leading-none tracking-widest whitespace-nowrap text-muted-foreground/60 transition-[opacity,max-width] duration-200 ${
          expanded ? "max-w-32 opacity-100 delay-75" : "max-w-0 opacity-0"
        }`}
      >
        {t(`nav.group.${group}`)}
      </span>
      <div className="h-px min-w-3 flex-1 bg-border" />
    </div>
  );
}

interface MenuTarget {
  id: string;
  title: string;
  promotable?: boolean;
  rightDockable?: boolean;
  hideable: boolean;
}

export function AppRail({
  railView,
  sidebarOpen,
  username,
  isAdmin,
  pluginsSettled = true,
  onRailClick,
  onOpenTab,
  onOpenInRightDock,
  onOpenSettings,
  onOpenNavigationSettings,
  onOpenPalette,
  onLogout,
}: {
  railView: RailView;
  sidebarOpen: boolean;
  username: string;
  isAdmin: boolean;
  /** False while plugins are still registering their rail items. */
  pluginsSettled?: boolean;
  onRailClick: (view: RailView) => void;
  onOpenTab?: (type: TabType) => void;
  onOpenInRightDock?: (view: RailView) => void;
  onOpenSettings: () => void;
  /** The rail menu's own entry, which jumps to the navigation settings. */
  onOpenNavigationSettings: () => void;
  onOpenPalette?: () => void;
  onLogout: (options?: { manual?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(() => readRailPreference("pinAppRail"));
  const [expandOnHover, setExpandOnHover] = useState(() =>
    readRailPreference("expandAppRailOnHover"),
  );
  const [showPinButton, setShowPinButton] = useState(() =>
    readRailPreference("showPinAppRailButton"),
  );
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
  const [managing, setManaging] = useState(false);
  const hiddenTabs = useHiddenRailTabs();

  useEffect(() => {
    const pinHandler = () => setPinned(readRailPreference("pinAppRail"));
    const hoverHandler = () =>
      setExpandOnHover(readRailPreference("expandAppRailOnHover"));
    const showPinButtonHandler = () =>
      setShowPinButton(readRailPreference("showPinAppRailButton"));
    window.addEventListener("pinAppRailChanged", pinHandler);
    window.addEventListener("expandAppRailOnHoverChanged", hoverHandler);
    window.addEventListener(
      "showPinAppRailButtonChanged",
      showPinButtonHandler,
    );
    return () => {
      window.removeEventListener("pinAppRailChanged", pinHandler);
      window.removeEventListener("expandAppRailOnHoverChanged", hoverHandler);
      window.removeEventListener(
        "showPinAppRailButtonChanged",
        showPinButtonHandler,
      );
    };
  }, []);

  useEffect(() => {
    if (!menuPos) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-rail-context-menu]")) {
        setMenuPos(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuPos(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuPos]);

  // Plugins add and remove rail items at runtime, and permissions hide some.
  const railItems = useRailItems();
  const uiPrefs = useUiPreferencesContext();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);

  const railExpanded = pinned || (expandOnHover && hovered) || managing;
  const mainItems = railItems.filter((item) => item.placement !== "footer");
  const bands = useMemo(
    () => groupRailItems(mainItems.filter((item) => !hiddenTabs.has(item.id))),
    [mainItems, hiddenTabs],
  );
  const hiddenItems = mainItems.filter((item) => hiddenTabs.has(item.id));
  const footerItems = railItems.filter(
    (item) => item.placement === "footer" && !hiddenTabs.has(item.id),
  );

  useEffect(() => {
    if (hiddenItems.length === 0) setManaging(false);
  }, [hiddenItems.length]);

  const togglePinned = () => {
    setRailPreference("pinAppRail", !pinned);
    setMenuPos(null);
  };

  const toggleExpandOnHover = () => {
    setRailPreference("expandAppRailOnHover", !expandOnHover);
    setMenuPos(null);
  };

  const sameBand = (a: string, b: string) =>
    (mainItems.find((item) => item.id === a)?.group ?? "tools") ===
    (mainItems.find((item) => item.id === b)?.group ?? "tools");

  const renderItem = (item: RailItemDef) => {
    const Icon = item.icon;
    const title = t(item.labelKey);
    const isTab = item.kind === "tab";
    const active = !isTab && sidebarOpen && railView === item.id;
    const reorderable = item.placement !== "footer" && !!uiPrefs;
    const dropHere =
      dragId !== null && dropBefore === item.id && dragId !== item.id;
    return (
      <button
        key={item.id}
        type="button"
        draggable={reorderable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          setDragId(item.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropBefore(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === item.id || !sameBand(dragId, item.id))
            return;
          e.preventDefault();
          setDropBefore(item.id);
        }}
        onDrop={(e) => {
          if (!dragId || !sameBand(dragId, item.id)) return;
          e.preventDefault();
          uiPrefs?.setOverride(
            "rail",
            "order",
            moveRailItem(mainItems, dragId, item.id),
          );
          setDragId(null);
          setDropBefore(null);
        }}
        onClick={(e) => {
          if (isTab || (item.promotable && (e.ctrlKey || e.metaKey))) {
            onOpenTab?.(item.id as TabType);
            return;
          }
          onRailClick(item.id as RailView);
        }}
        onAuxClick={(e) => {
          if (e.button !== 1 || !item.promotable) return;
          e.preventDefault();
          onOpenTab?.(item.id as TabType);
        }}
        onContextMenu={() =>
          setMenuTarget({
            id: item.id,
            title,
            promotable: item.promotable,
            rightDockable: item.rightDockable,
            hideable: !item.alwaysVisible && item.hideable !== false,
          })
        }
        data-rail-item=""
        aria-current={active ? "page" : undefined}
        title={item.promotable ? `${title}\n${t("nav.openAsTabHint")}` : title}
        style={btnStyle}
        className={`${btnBase} ${active ? activeClass : idle} ${dragId === item.id ? "opacity-40" : ""} ${dropHere ? "relative before:absolute before:inset-x-1 before:-top-0.5 before:h-0.5 before:bg-accent-brand" : ""}`}
      >
        <RailIcon useBadge={item.useBadge}>
          <Icon size={16} />
        </RailIcon>
        <RailLabel expanded={railExpanded}>{title}</RailLabel>
      </button>
    );
  };

  return (
    <div
      className="hidden md:flex flex-col items-stretch bg-sidebar border-r border-border shrink-0 overflow-hidden pt-2 gap-1 transition-[width] duration-200 min-h-0"
      style={{ width: rem(railExpanded ? 172 : 40) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        // Keep the menu on screen when right-clicking near the viewport edges
        const MENU_W = 200;
        const MENU_H = 180;
        setMenuPos({
          x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
          y: Math.min(e.clientY, window.innerHeight - MENU_H - 8),
        });
        if (!(e.target as HTMLElement).closest("[data-rail-item]")) {
          setMenuTarget(null);
        }
      }}
    >
      {onOpenPalette && (
        <>
          <button
            type="button"
            onClick={onOpenPalette}
            title={t("nav.searchEverything")}
            aria-label={t("nav.searchEverything")}
            style={btnStyle}
            className={`${btnBase} ${idle}`}
          >
            <RailIcon>
              <Search size={16} />
            </RailIcon>
            <RailLabel expanded={railExpanded}>{t("nav.search")}</RailLabel>
          </button>
          <Rule expanded={railExpanded} />
        </>
      )}

      <div className="flex flex-col flex-1 gap-1 overflow-y-auto scrollbar-none min-h-0">
        {!pluginsSettled
          ? Array.from({ length: mainItems.length || 8 }, (_, i) => (
              <div
                key={`rail-skeleton-${i}`}
                style={btnStyle}
                className="flex items-center h-7 shrink-0"
              >
                <Skeleton className="size-4 shrink-0" />
              </div>
            ))
          : bands.map((band, i) => (
              <div key={band.group} className="flex flex-col gap-1">
                {i > 0 && (
                  <GroupDivider group={band.group} expanded={railExpanded} />
                )}
                {band.items.map(renderItem)}
              </div>
            ))}

        {pluginsSettled && hiddenItems.length > 0 && (
          <>
            <Rule expanded={railExpanded} />
            <button
              type="button"
              onClick={() => setManaging((v) => !v)}
              aria-expanded={managing}
              title={t("nav.hiddenCount", { count: hiddenItems.length })}
              style={btnStyle}
              className={`${btnBase} ${managing ? activeClass : idle}`}
            >
              <RailIcon>
                <EyeOff size={16} />
              </RailIcon>
              <RailLabel expanded={railExpanded}>
                {t("nav.hiddenCount", { count: hiddenItems.length })}
              </RailLabel>
            </button>
            {managing &&
              hiddenItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={`hidden-${item.id}`}
                    type="button"
                    onClick={() => void toggleHiddenRailTab(item.id)}
                    title={t("nav.showInRail")}
                    style={btnStyle}
                    className={`${btnBase} text-muted-foreground/70 hover:text-foreground hover:bg-muted/60`}
                  >
                    <RailIcon>
                      <Icon size={16} />
                    </RailIcon>
                    <span className="min-w-0 truncate text-xs font-medium whitespace-nowrap">
                      {t(item.labelKey)}
                    </span>
                    <Eye className="ml-auto size-3 shrink-0 opacity-60" />
                  </button>
                );
              })}
          </>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-1 border-t border-border pt-1 pb-1">
        {showPinButton && (
          <>
            <button
              type="button"
              onClick={() => setRailPreference("pinAppRail", !pinned)}
              style={btnStyle}
              title={
                pinned ? t("nav.collapseSideMenu") : t("nav.keepSideMenuOpen")
              }
              className={`${btnBase} ${pinned ? activeClass : idle}`}
            >
              <RailIcon>
                <Pin size={16} />
              </RailIcon>
              <RailLabel expanded={railExpanded}>
                {pinned ? t("nav.collapseSideMenu") : t("nav.keepSideMenuOpen")}
              </RailLabel>
            </button>
            <Rule expanded={railExpanded} />
          </>
        )}
        {footerItems.map(renderItem)}
        {footerItems.length > 0 && !isElectron() && (
          <Rule expanded={railExpanded} />
        )}
        {/* The desktop signs in to its own local profile by itself. */}
        {!isElectron() && (
          <button
            type="button"
            onClick={() => onLogout({ manual: true })}
            style={btnStyle}
            title={t("common.logout")}
            aria-label={t("common.logout")}
            className={`${btnBase} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
          >
            <RailIcon>
              <LogOut size={16} />
            </RailIcon>
            <RailLabel expanded={railExpanded}>{t("common.logout")}</RailLabel>
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-border">
        <button
          type="button"
          onClick={onOpenSettings}
          title={t("nav.openSettings")}
          aria-label={t("nav.openSettings")}
          className="flex items-center gap-2.5 w-full h-10 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:ring-1 focus-visible:ring-ring"
          style={{ padding: `0 ${rem(8)}` }}
        >
          <div
            className="rounded-full bg-accent-brand/20 border border-accent-brand/30 flex items-center justify-center font-bold text-accent-brand shrink-0"
            style={{ width: rem(24), height: rem(24), fontSize: rem(11) }}
          >
            {username.charAt(0).toUpperCase() || "U"}
          </div>
          <div
            className={`flex flex-col items-start overflow-hidden transition-opacity duration-150 ${
              railExpanded ? "opacity-100 delay-75" : "opacity-0"
            }`}
          >
            <span className="text-xs font-semibold leading-tight whitespace-nowrap">
              {username || t("nav.roleUser")}
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">
              {isAdmin ? t("nav.roleAdministrator") : t("nav.roleUser")}
            </span>
          </div>
        </button>
      </div>

      {menuPos && (
        <div
          data-rail-context-menu
          role="menu"
          style={{ position: "fixed", left: menuPos.x, top: menuPos.y }}
          className="z-[10000] bg-popover border border-border shadow-lg py-1 min-w-[200px]"
        >
          {menuTarget && (
            <>
              {menuTarget.promotable && (
                <MenuItem
                  icon={<SquareArrowOutUpRight className="size-3" />}
                  onClick={() => {
                    onOpenTab?.(menuTarget.id as TabType);
                    setMenuPos(null);
                  }}
                >
                  {t("nav.openAsTab")}
                </MenuItem>
              )}
              {menuTarget.rightDockable && (
                <MenuItem
                  icon={<PanelRight className="size-3" />}
                  onClick={() => {
                    onOpenInRightDock?.(menuTarget.id);
                    setMenuPos(null);
                  }}
                >
                  {t("nav.openInRightDock")}
                </MenuItem>
              )}
              {menuTarget.hideable && (
                <MenuItem
                  icon={<EyeOff className="size-3" />}
                  onClick={() => {
                    void toggleHiddenRailTab(menuTarget.id);
                    setMenuPos(null);
                  }}
                >
                  {t("nav.hideFromRail")}
                </MenuItem>
              )}
              <div className="h-px bg-border my-1" />
            </>
          )}
          <MenuItem
            icon={pinned ? <Check className="size-3" /> : null}
            onClick={togglePinned}
            checked={pinned}
          >
            {t("newUi.sidebar.userProfile.pinAppRail")}
          </MenuItem>
          <MenuItem
            icon={expandOnHover ? <Check className="size-3" /> : null}
            onClick={toggleExpandOnHover}
            checked={expandOnHover}
          >
            {t("newUi.sidebar.userProfile.expandAppRailOnHover")}
          </MenuItem>
          <div className="h-px bg-border my-1" />
          <MenuItem
            icon={<SlidersHorizontal className="size-3" />}
            onClick={() => {
              onOpenNavigationSettings();
              setMenuPos(null);
            }}
          >
            {t("nav.openSettings")}
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  checked,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  checked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
    >
      <span className="shrink-0 w-3 flex items-center justify-center">
        {icon}
      </span>
      {children}
    </button>
  );
}
