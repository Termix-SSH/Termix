import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Hammer,
  KeyRound,
  LayoutPanelLeft,
  Network,
  Play,
  Plug,
  Server,
  Settings,
  User,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import type { SplitMode, TabType, ToolsTab } from "@/types/ui-types";

export type RailView =
  | "hosts"
  | "credentials"
  | "quick-connect"
  | ToolsTab
  | "connections"
  | "user-profile"
  | "admin-settings";

type RailItem =
  | {
      kind?: undefined;
      view: RailView;
      icon: React.ReactNode;
      title: string;
      dot?: boolean;
    }
  | { kind: "tab"; tabType: TabType; icon: React.ReactNode; title: string }
  | { kind: "separator" };

function buildRailButtons(
  splitMode: SplitMode,
  t: (key: string) => string,
  connectionCount: number,
): RailItem[] {
  return [
    { view: "hosts", icon: <Server size={16} />, title: t("nav.hosts") },
    {
      view: "credentials",
      icon: <KeyRound size={16} />,
      title: t("nav.credentials"),
    },
    { kind: "separator" },
    {
      view: "connections",
      icon: <Plug size={16} />,
      title: t("nav.connections"),
    },
    { kind: "separator" },
    {
      view: "quick-connect",
      icon: <Zap size={16} />,
      title: t("nav.quickConnect"),
    },
    { kind: "separator" },
    { view: "ssh-tools", icon: <Hammer size={16} />, title: t("nav.sshTools") },
    { kind: "separator" },
    { view: "snippets", icon: <Play size={16} />, title: t("nav.snippets") },
    { kind: "separator" },
    { view: "history", icon: <Clock size={16} />, title: t("nav.history") },
    { kind: "separator" },
    {
      view: "split-screen",
      icon: <LayoutPanelLeft size={16} />,
      title: t("nav.splitScreen"),
      dot: splitMode !== "none",
    },
    { kind: "separator" },
    {
      kind: "tab",
      tabType: "network_graph" as TabType,
      icon: <Network size={16} />,
      title: t("nav.networkGraph"),
    },
    { kind: "separator" },
  ];
}

const btnBase =
  "relative flex items-center gap-2.5 h-7 rounded shrink-0 transition-colors";
const btnStyle = { margin: "0 4px", padding: "0 6px" };

export function AppRail({
  railView,
  sidebarOpen,
  splitMode,
  connectionCount,
  username,
  isAdmin,
  profileDropdownOpen,
  onProfileDropdownChange,
  onRailClick,
  onOpenTab,
  onLogout,
}: {
  railView: RailView;
  sidebarOpen: boolean;
  splitMode: SplitMode;
  connectionCount: number;
  username: string;
  isAdmin: boolean;
  profileDropdownOpen: boolean;
  onProfileDropdownChange: (open: boolean) => void;
  onRailClick: (view: RailView) => void;
  onOpenTab?: (type: TabType) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(
    () => localStorage.getItem("pinAppRail") === "true",
  );

  useEffect(() => {
    const handler = () =>
      setPinned(localStorage.getItem("pinAppRail") === "true");
    window.addEventListener("pinAppRailChanged", handler);
    return () => window.removeEventListener("pinAppRailChanged", handler);
  }, []);

  const railExpanded = pinned || hovered || profileDropdownOpen;
  const railButtons = buildRailButtons(splitMode, t, connectionCount);

  return (
    <div
      className="hidden md:flex flex-col items-stretch bg-sidebar border-r border-border shrink-0 overflow-hidden pt-2 gap-1 transition-[width] duration-200"
      style={{ width: railExpanded ? 160 : 40 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col flex-1 gap-1">
        {railButtons.map((item, i) =>
          item.kind === "separator" ? (
            <div
              key={`sep-${i}`}
              className="mx-auto h-px bg-border my-0.5 shrink-0 transition-[width] duration-200"
              style={{ width: railExpanded ? "calc(100% - 16px)" : 20 }}
            />
          ) : item.kind === "tab" ? (
            <button
              key={item.tabType}
              onClick={() => onOpenTab?.(item.tabType)}
              style={btnStyle}
              className={`${btnBase} text-muted-foreground hover:text-foreground hover:bg-muted/60`}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 16, height: 16 }}
              >
                {item.icon}
              </span>
              <span
                className={`text-xs font-medium whitespace-nowrap overflow-hidden transition-opacity duration-150 ${
                  railExpanded ? "opacity-100 delay-75" : "opacity-0"
                }`}
              >
                {item.title}
              </span>
            </button>
          ) : (
            <button
              key={item.view}
              onClick={() => onRailClick(item.view)}
              style={btnStyle}
              className={`${btnBase} ${
                sidebarOpen && railView === item.view
                  ? "text-accent-brand bg-accent-brand/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              <span
                className="shrink-0 flex items-center justify-center"
                style={{ width: 16, height: 16 }}
              >
                {item.icon}
              </span>
              <span
                className={`text-xs font-medium whitespace-nowrap overflow-hidden transition-opacity duration-150 ${
                  railExpanded ? "opacity-100 delay-75" : "opacity-0"
                }`}
              >
                {item.title}
              </span>
              {item.dot && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent-brand" />
              )}
            </button>
          ),
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-1 border-t border-border pt-1 pb-1">
        {[
          {
            view: "user-profile" as RailView,
            icon: <User size={16} />,
            title: t("nav.userProfile"),
          },
          ...(isAdmin
            ? [
                {
                  view: "admin-settings" as RailView,
                  icon: <Settings size={16} />,
                  title: t("nav.admin"),
                },
              ]
            : []),
        ].map((item) => (
          <button
            key={item.view}
            onClick={() => onRailClick(item.view)}
            style={btnStyle}
            className={`${btnBase} ${
              sidebarOpen && railView === item.view
                ? "text-accent-brand bg-accent-brand/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <span
              className="shrink-0 flex items-center justify-center"
              style={{ width: 16, height: 16 }}
            >
              {item.icon}
            </span>
            <span
              className={`text-xs font-medium whitespace-nowrap overflow-hidden transition-opacity duration-150 ${railExpanded ? "opacity-100 delay-75" : "opacity-0"}`}
            >
              {item.title}
            </span>
          </button>
        ))}
      </div>

      <div className="shrink-0 border-t border-border">
        <DropdownMenu
          open={profileDropdownOpen}
          onOpenChange={onProfileDropdownChange}
        >
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2.5 w-full h-10 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              style={{ padding: "0 6px" }}
            >
              <div
                className="rounded-full bg-accent-brand/20 border border-accent-brand/30 flex items-center justify-center font-bold text-accent-brand shrink-0"
                style={{ width: 24, height: 24, fontSize: 11 }}
              >
                {username.charAt(0).toUpperCase() || "U"}
              </div>
              <div
                className={`flex flex-col items-start overflow-hidden transition-opacity duration-150 ${
                  railExpanded ? "opacity-100 delay-75" : "opacity-0"
                }`}
              >
                <span className="text-xs font-semibold leading-tight whitespace-nowrap">
                  {username || "User"}
                </span>
                <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">
                  {isAdmin ? t("nav.roleAdministrator") : t("nav.roleUser")}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={1}
            className="!w-auto min-w-max [clip-path:inset(-4px_-4px_-4px_0px)]"
          >
            <DropdownMenuItem variant="destructive" onClick={onLogout}>
              <KeyRound size={14} />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
