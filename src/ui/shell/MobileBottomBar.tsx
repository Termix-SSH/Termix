import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogOut, MoreHorizontal, Settings, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/dropdown-menu";
import type { RailView } from "@/sidebar/AppRail";
import { visibleRailItems } from "@/sidebar/rail-items";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import type { SplitMode } from "@/types/ui-types";
import { readHiddenRailTabs } from "@/sidebar/hidden-rail-tabs";

export function MobileBottomBar({
  railView,
  sidebarOpen,
  splitMode,
  onRailClick,
}: {
  railView: RailView;
  sidebarOpen: boolean;
  splitMode: SplitMode;
  onRailClick: (view: RailView) => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(readHiddenRailTabs);
  const { userEnabled: aiEnabled } = useAiAvailability();

  // The rail's visibility toggles apply on mobile too; this used to ignore
  // them, so hiding a tab did nothing on a phone.
  useEffect(() => {
    const handler = () => setHidden(readHiddenRailTabs());
    window.addEventListener("hiddenRailTabsChanged", handler);
    return () => window.removeEventListener("hiddenRailTabsChanged", handler);
  }, []);

  const { primaryItems, moreItems } = useMemo(() => {
    // Tab-opening entries (network graph) have no sidebar panel to show here.
    const visible = visibleRailItems().filter(
      (item) =>
        item.kind !== "tab" &&
        !hidden.has(item.id) &&
        (item.id !== "ai" || aiEnabled),
    );
    const preferred = visible.filter((item) => item.mobilePrimary);
    // Keep four primary slots filled even when the user hides the defaults,
    // so the bar never collapses to just "More".
    const primary = [
      ...preferred,
      ...visible.filter((item) => !item.mobilePrimary),
    ].slice(0, 4);
    const primaryIds = new Set(primary.map((item) => item.id));
    return {
      primaryItems: primary,
      moreItems: visible.filter((item) => !primaryIds.has(item.id)),
    };
  }, [hidden, aiEnabled]);

  const moreActive =
    sidebarOpen &&
    (moreItems.some((item) => item.id === railView) ||
      railView === "user-profile" ||
      railView === "admin-settings");

  return (
    <div className="md:hidden flex items-stretch shrink-0 bg-sidebar border-t border-border safe-bottom">
      {primaryItems.map((item) => {
        const active = sidebarOpen && railView === item.id;
        const hasDot = item.id === "split-screen" && splitMode !== "none";
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            onClick={() => onRailClick(item.id as RailView)}
            className={`relative flex flex-col items-center justify-center flex-1 gap-0.5 py-2 min-h-[56px] transition-colors text-[10px] font-medium
              ${active ? "text-accent-brand" : "text-muted-foreground"}`}
          >
            <Icon className="size-5" />
            <span className="max-w-full truncate px-0.5">
              {t(item.labelKey)}
            </span>
            {hasDot && (
              <span className="absolute top-1.5 right-[calc(50%-10px)] size-1.5 rounded-full bg-accent-brand" />
            )}
          </button>
        );
      })}

      <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={`relative flex flex-col items-center justify-center flex-1 gap-0.5 py-2 min-h-[56px] transition-colors text-[10px] font-medium
              ${moreActive ? "text-accent-brand" : "text-muted-foreground"}`}
          >
            <MoreHorizontal className="size-5" />
            <span>{t("common.more")}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className="mb-1 min-w-[180px] max-h-[60vh] overflow-y-auto"
        >
          {moreItems.map((item) => {
            const active = sidebarOpen && railView === item.id;
            const Icon = item.icon;
            return (
              <DropdownMenuItem
                key={item.id}
                onClick={() => {
                  onRailClick(item.id as RailView);
                  setMoreOpen(false);
                }}
                className={active ? "text-accent-brand" : ""}
              >
                <Icon className="size-4" />
                {t(item.labelKey)}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              onRailClick("user-profile");
              setMoreOpen(false);
            }}
            className={
              sidebarOpen && railView === "user-profile"
                ? "text-accent-brand"
                : ""
            }
          >
            <User className="size-4" />
            {t("nav.userProfile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              onRailClick("admin-settings");
              setMoreOpen(false);
            }}
            className={
              sidebarOpen && railView === "admin-settings"
                ? "text-accent-brand"
                : ""
            }
          >
            <Settings className="size-4" />
            {t("nav.admin")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => window.dispatchEvent(new Event("termix:logout"))}
          >
            <LogOut className="size-4" />
            {t("common.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
