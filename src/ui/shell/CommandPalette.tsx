import React, { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/kbd";
import {
  Command,
  CommandItem,
  CommandList,
  CommandGroup,
  CommandEmpty,
} from "@/components/command";
import {
  BookOpen,
  Bug,
  Clock,
  FlaskConical,
  Folder,
  Globe,
  KeyRound,
  MessagesSquare,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { getRecentActivity, type RecentActivityItem } from "@/main-axios";
import type { Host, TabType, Tab } from "@/types/ui-types";
import { canEditHost } from "@/sidebar/host-permissions";
import { useRailItems } from "@/sidebar/rail-items";
import {
  defaultConnectAction,
  hostActionsFor,
  runHostAction,
  useHostActions,
} from "@/sidebar/host-contributions";
import {
  filterPaletteItems,
  loadPaletteGroup,
  paletteEntriesFor,
  usePaletteEntries,
  usePaletteGroups,
  type PaletteItemDef,
} from "./palette-registry";
import { activityTarget } from "@/lib/activity-types";
import { reportBetaFeedbackUrl, reportCoreIssueUrl } from "@/lib/issue-url";
import { isPrerelease } from "@/plugins/plugin-model";
import { shell } from "@/plugin-host/shell-bridge";
import { getLiveHostStatus } from "@/lib/ServerStatusContext";
import { docsUrl } from "@/lib/docs";

interface CommandPaletteProps {
  /** Opens settings, optionally at one section. */
  onOpenSettings?: (section?: string) => void;
  /** Opens a host in the editor. */
  onEditHost?: (host: Host) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  hosts: Host[];
  terminalTabs?: Tab[];
  activeTabId?: string;
  onOpenTab: (type: TabType, label?: string, pendingEvent?: string) => void;
  /** Opens a sidebar panel. Kept separate from onOpenTab, which is TabType-shaped. */
  onOpenPanel?: (view: string) => void;
}

export function CommandPalette({
  isOpen,
  setIsOpen,
  hosts,
  terminalTabs = [],
  activeTabId = "",
  onOpenTab,
  onOpenPanel,
  onOpenSettings,
  onEditHost,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const railItems = useRailItems();
  const hostActions = useHostActions();
  const paletteEntries = usePaletteEntries();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );
  const paletteGroups = usePaletteGroups();
  const [groupItems, setGroupItems] = useState<
    Record<string, PaletteItemDef[]>
  >({});
  const [selectedValue, setSelectedValue] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch("");
      getRecentActivity(5)
        .then(setRecentActivity)
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    for (const group of paletteGroups) {
      void loadPaletteGroup(group).then((items) => {
        if (!cancelled) {
          setGroupItems((prev) => ({ ...prev, [group.id]: items }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, paletteGroups]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, setIsOpen]);

  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  // Without a query the list is a short starting point, not every host.
  const filteredHosts = searching
    ? hosts.filter(
        (h) =>
          h.name.toLowerCase().includes(query) ||
          h.ip.toLowerCase().includes(query) ||
          h.username.toLowerCase().includes(query) ||
          h.folder?.toLowerCase().includes(query) ||
          h.tags?.some((tag) => tag.toLowerCase().includes(query)),
      )
    : hosts.slice(0, 6);

  // Group hosts by folder; ungrouped hosts appear first.
  const groupedHosts: { folder: string | null; hosts: Host[] }[] = [];
  const folderMap = new Map<string, Host[]>();
  const ungrouped: Host[] = [];
  for (const h of filteredHosts) {
    if (h.folder && searching) {
      if (!folderMap.has(h.folder)) folderMap.set(h.folder, []);
      folderMap.get(h.folder)!.push(h);
    } else {
      ungrouped.push(h);
    }
  }
  if (ungrouped.length > 0)
    groupedHosts.push({ folder: null, hosts: ungrouped });
  for (const [folder, fhosts] of folderMap) {
    groupedHosts.push({ folder, hosts: fhosts });
  }

  useEffect(() => {
    if (!isOpen) return;
    const firstHost = filteredHosts[0];
    setSelectedValue(searching && firstHost ? `host-${firstHost.id}` : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, search]);

  const activeTargetTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  const matches = (...texts: (string | undefined)[]) =>
    !searching || texts.some((text) => text?.toLowerCase().includes(query));

  const destinations = railItems.filter((item) => matches(t(item.labelKey)));

  const quickActions = [
    {
      id: "quick-action-add-host",
      label: t("commandPalette.addNewHost"),
      icon: Plus,
      run: () => onOpenTab("host-manager", undefined, "host-manager:add-host"),
    },
    {
      id: "quick-action-add-credential",
      label: t("commandPalette.addCredential"),
      icon: KeyRound,
      run: () =>
        onOpenTab("host-manager", undefined, "host-manager:add-credential"),
    },
    {
      id: "quick-action-settings",
      label: t("nav.settings"),
      icon: Settings,
      run: () =>
        onOpenSettings ? onOpenSettings() : onOpenTab("user-profile"),
    },
    {
      id: "quick-action-admin-settings",
      label: t("commandPalette.adminSettings"),
      icon: ShieldCheck,
      run: () =>
        onOpenSettings
          ? onOpenSettings("admin-general")
          : onOpenTab("admin-settings"),
    },
  ].filter((action) => matches(action.label));

  const globalEntries = paletteEntriesFor(paletteEntries, "global").filter(
    (entry) => matches(t(entry.titleKey), ...(entry.keywords ?? [])),
  );

  const links = [
    {
      id: "link-docs",
      label: t("commandPalette.documentation"),
      icon: BookOpen,
      url: docsUrl(),
    },
    {
      id: "link-github",
      label: "GitHub",
      icon: Globe,
      url: "https://github.com/Termix-SSH/Termix",
    },
    {
      id: "link-discord",
      label: "Discord",
      icon: MessagesSquare,
      url: "https://discord.com/invite/jVQGdvHDrf",
    },
    {
      id: "link-report-bug",
      label: t("dashboard.reportBug"),
      icon: Bug,
      url: reportCoreIssueUrl(import.meta.env.VITE_APP_VERSION || undefined),
    },
    ...(isPrerelease(import.meta.env.VITE_APP_VERSION)
      ? [
          {
            id: "link-beta-feedback",
            label: t("newUi.sidebar.userProfile.sendBetaFeedback"),
            icon: FlaskConical,
            url: reportBetaFeedbackUrl(import.meta.env.VITE_APP_VERSION),
          },
        ]
      : []),
  ].filter((link) => matches(link.label));

  const rowClass = "group gap-2 rounded-none";
  const iconClass = "size-3.5 shrink-0 text-muted-foreground";
  const hostButton =
    "flex size-6 items-center justify-center border border-border text-muted-foreground transition-colors hover:border-accent-brand hover:text-accent-brand";

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-background/70 pt-[15vh]"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="motion-context-enter mx-4 w-full max-w-2xl overflow-hidden border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          className="rounded-none"
          shouldFilter={false}
          loop
          value={selectedValue}
          onValueChange={setSelectedValue}
        >
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder={t("commandPalette.searchPlaceholder")}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Kbd className="ml-2">ESC</Kbd>
          </div>

          <CommandList className="thin-scrollbar max-h-[60vh] [contain:content]">
            <CommandEmpty className="py-8 text-center text-xs text-muted-foreground">
              {t("commandPalette.noHostsFound", { search })}
            </CommandEmpty>

            {!searching && recentActivity.length > 0 && (
              <CommandGroup heading={t("commandPalette.recentActivity")}>
                {recentActivity.slice(0, 4).map((item) => {
                  const Icon = activityTarget(item.type)?.icon ?? Server;
                  return (
                    <CommandItem
                      key={item.id}
                      value={`recent-activity-${item.id}`}
                      onSelect={() =>
                        handleAction(() => {
                          const target = activityTarget(item.type);
                          if (target) onOpenTab(target.tab, item.hostName);
                        })
                      }
                      className={rowClass}
                    >
                      <Icon className={iconClass} />
                      <span className="truncate">{item.hostName}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="size-3" />
                        {new Date(item.timestamp).toLocaleDateString()}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {filteredHosts.length > 0 && (
              <CommandGroup heading={t("commandPalette.serversAndHosts")}>
                {groupedHosts.map(({ folder, hosts: groupHosts }) => (
                  <div key={folder ?? "__root__"}>
                    {folder && (
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        <Folder className="size-3" />
                        {folder}
                      </div>
                    )}
                    {groupHosts.map((host) => {
                      const online =
                        getLiveHostStatus(Number(host.id)) === "online";
                      return (
                        <CommandItem
                          key={host.id}
                          value={`host-${host.id}`}
                          onSelect={() =>
                            handleAction(() => {
                              const action = defaultConnectAction(
                                hostActions,
                                host,
                              );
                              if (action) runHostAction(action, host, shell);
                            })
                          }
                          className={rowClass}
                        >
                          <Server
                            className={cn(
                              "size-3.5 shrink-0",
                              online
                                ? "text-accent-brand"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="truncate">{host.name}</span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {host.username}@{host.ip}
                          </span>
                          {host.isShared && (
                            <span className="shrink-0 border border-accent-brand/30 bg-accent-brand/10 px-1 text-[9px] uppercase leading-none tracking-wider text-accent-brand">
                              {t("hosts.sharing.sharedBadge")}
                            </span>
                          )}
                          <span
                            className={cn(
                              "ml-auto flex shrink-0 items-center gap-1",
                              !searching &&
                                "opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100",
                            )}
                          >
                            {hostActionsFor(hostActions, host).map((action) => {
                              const Icon = action.icon;
                              const label =
                                action.label?.(host) ?? t(action.titleKey);
                              return (
                                <button
                                  key={action.id}
                                  type="button"
                                  title={label}
                                  aria-label={label}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(() =>
                                      runHostAction(action, host, shell),
                                    );
                                  }}
                                  className={hostButton}
                                >
                                  <Icon className="size-3" />
                                </button>
                              );
                            })}
                            {paletteEntriesFor(
                              paletteEntries,
                              "host",
                              host,
                            ).map((entry) => {
                              const Icon = entry.icon;
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  title={t(entry.titleKey)}
                                  aria-label={t(entry.titleKey)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(() => entry.run(shell, host));
                                  }}
                                  className={hostButton}
                                >
                                  {Icon && <Icon className="size-3" />}
                                </button>
                              );
                            })}
                            {canEditHost(host) && (
                              <button
                                type="button"
                                title={t("hosts.editHost")}
                                aria-label={t("hosts.editHost")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(() => onEditHost?.(host));
                                }}
                                className={hostButton}
                              >
                                <Pencil className="size-3" />
                              </button>
                            )}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </div>
                ))}
              </CommandGroup>
            )}

            {paletteGroups.map((group) => {
              const items = filterPaletteItems(
                groupItems[group.id] ?? [],
                search,
                group.showWhenEmpty,
              );
              if (items.length === 0) return null;
              return (
                <CommandGroup
                  key={`group-${group.id}`}
                  heading={t(group.titleKey)}
                >
                  {items.map((item) => {
                    const Icon = item.icon;
                    const blocked = !!item.needsTarget && !activeTargetTab;
                    return (
                      <CommandItem
                        key={`${group.id}-${item.id}`}
                        value={`group-${group.id}-${item.id}`}
                        onSelect={() => {
                          if (blocked) return;
                          handleAction(() =>
                            item.run({ targetTab: activeTargetTab, shell }),
                          );
                        }}
                        className={cn(
                          rowClass,
                          blocked && "pointer-events-none opacity-50",
                        )}
                      >
                        {Icon && <Icon className={iconClass} />}
                        <span className="truncate">{item.title}</span>
                        {item.description && (
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                        {(blocked || item.hint) && (
                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                            {blocked
                              ? t("commandPalette.noTargetTab")
                              : item.hint}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}

            {onOpenPanel && destinations.length > 0 && (
              <CommandGroup heading={t("commandPalette.navigation")}>
                {destinations.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={`nav-${item.id}`}
                      value={`nav-${item.id}`}
                      onSelect={() =>
                        handleAction(() =>
                          item.kind === "tab"
                            ? onOpenTab(item.id as TabType)
                            : onOpenPanel(item.id),
                        )
                      }
                      className={rowClass}
                    >
                      <Icon className={iconClass} />
                      <span className="truncate">{t(item.labelKey)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {quickActions.length > 0 && (
              <CommandGroup heading={t("commandPalette.quickActions")}>
                {quickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <CommandItem
                      key={action.id}
                      value={action.id}
                      onSelect={() => handleAction(action.run)}
                      className={rowClass}
                    >
                      <Icon className={iconClass} />
                      {action.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {globalEntries.length > 0 && (
              <CommandGroup heading={t("commandPalette.pluginActions")}>
                {globalEntries.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <CommandItem
                      key={`plugin-${entry.id}`}
                      value={`plugin-${entry.id}`}
                      onSelect={() => handleAction(() => entry.run(shell))}
                      className={rowClass}
                    >
                      {Icon && <Icon className={iconClass} />}
                      {t(entry.titleKey)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {links.length > 0 && (
              <CommandGroup heading={t("commandPalette.links")}>
                {links.map((link) => {
                  const Icon = link.icon;
                  return (
                    <CommandItem
                      key={link.id}
                      value={link.id}
                      onSelect={() => window.open(link.url, "_blank")}
                      className={rowClass}
                    >
                      <Icon className={iconClass} />
                      {link.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd className="h-4">↑↓</Kbd>
              {t("commandPalette.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd className="h-4">↵</Kbd>
              {t("commandPalette.select")}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Kbd className="h-4">Ctrl</Kbd>
              <span className="opacity-50">+</span>
              <Kbd className="h-4">K</Kbd>
              <span className="px-1 opacity-50">
                {t("commandPalette.orShortcut")}
              </span>
              <Kbd className="h-4">⇧⇧</Kbd>
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
