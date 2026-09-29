import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { Input } from "@/components/input";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { tabIcon } from "@/shell/tabUtils";
import {
  hostActionsFor,
  useHostActions,
  type HostActionDef,
} from "@/sidebar/host-contributions";
import type { Host, Tab } from "@/types/ui-types";

/** Hosts listed before a search narrows them down. */
const HOST_LIMIT = 60;

export interface NewTabOption {
  type: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

export type PickHostTarget =
  | { action: HostActionDef }
  | { action: HostActionDef; item: { id: string; label: string } };

function HostActionButton({
  host,
  action,
  onPick,
}: {
  host: Host;
  action: HostActionDef;
  onPick: (target: PickHostTarget) => void;
}) {
  const { t } = useTranslation();
  const Icon = action.icon;
  const title = action.label?.(host) ?? t(action.titleKey);
  const items = action.items?.(host) ?? [];
  const button = (
    <button
      type="button"
      title={title}
      aria-label={`${host.name}: ${title}`}
      className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:bg-accent-brand/10 hover:text-accent-brand"
      onClick={items.length > 1 ? undefined : () => onPick({ action })}
    >
      <Icon className="size-3.5" />
    </button>
  );
  if (items.length <= 1) return button;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.id}
            onSelect={() => onPick({ action, item })}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * What an empty pane shows: the tabs that could move in, new tabs to start,
 * and every host with the ways to open it. Picking anything fills this pane.
 */
export function EmptyPanePicker({
  paneIndex,
  freeTabs,
  hosts,
  newTabOptions,
  onPickTab,
  onPickHost,
  onOpenType,
  onClosePane,
}: {
  paneIndex: number;
  freeTabs: Tab[];
  hosts: Host[];
  newTabOptions: NewTabOption[];
  onPickTab: (tabId: string) => void;
  onPickHost: (host: Host, target: PickHostTarget) => void;
  onOpenType: (type: string) => void;
  onClosePane: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const allActions = useHostActions();

  const shownHosts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? hosts.filter((host) =>
          [host.name, host.ip, host.username, host.folder]
            .filter(Boolean)
            .some((field) => String(field).toLowerCase().includes(q)),
        )
      : hosts;
    return [...matches]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, HOST_LIMIT);
  }, [hosts, query]);

  return (
    <div
      className="flex size-full justify-center overflow-y-auto bg-background p-4"
      data-split-empty-pane
    >
      <div className="flex w-full max-w-md flex-col gap-4 self-start">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">
            {t("splitScreen.emptyTitle")}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t("splitScreen.paneNumber", { index: paneIndex })}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {t("splitScreen.emptyHint")}
          </span>
        </div>

        <section className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("splitScreen.openTabs")}
          </span>
          {freeTabs.length === 0 ? (
            <span className="text-xs text-muted-foreground/70">
              {t("splitScreen.noOpenTabs")}
            </span>
          ) : (
            <div className="flex flex-col border border-border">
              {freeTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-left text-xs last:border-b-0 hover:bg-accent-brand/10 hover:text-accent-brand"
                  onClick={() => onPickTab(tab.id)}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {tabIcon(tab.type)}
                  </span>
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {newTabOptions.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("splitScreen.newSession")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {newTabOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.type}
                    type="button"
                    className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-xs hover:border-accent-brand/40 hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={() => onOpenType(option.type)}
                  >
                    {Icon && <Icon className="size-3.5" />}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("splitScreen.hosts")}
          </span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("splitScreen.searchHosts")}
              aria-label={t("splitScreen.searchHosts")}
              className="h-8 rounded-none pl-7 text-xs"
            />
          </div>
          {shownHosts.length === 0 ? (
            <span className="text-xs text-muted-foreground/70">
              {t("splitScreen.noHosts")}
            </span>
          ) : (
            <div className="flex flex-col border border-border">
              {shownHosts.map((host) => {
                const actions = hostActionsFor(allActions, host);
                const connect = actions
                  .filter((action) => action.kind === "connect")
                  .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
                const open = actions.filter((action) => action.kind === "open");
                const primary = connect[0];
                return (
                  <div
                    key={host.id}
                    className="flex items-center gap-2 border-b border-border px-2.5 py-1 last:border-b-0"
                  >
                    <button
                      type="button"
                      disabled={!primary}
                      className="flex min-w-0 flex-1 flex-col items-start text-left text-xs enabled:hover:text-accent-brand disabled:opacity-60"
                      onClick={() =>
                        primary && onPickHost(host, { action: primary })
                      }
                    >
                      <span className="w-full truncate font-medium">
                        {host.name}
                      </span>
                      <span className="w-full truncate text-[10px] text-muted-foreground">
                        {host.username ? `${host.username}@` : ""}
                        {host.ip}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center">
                      {[...connect, ...open].map((action) => (
                        <HostActionButton
                          key={action.id}
                          host={host}
                          action={action}
                          onPick={(target) => onPickHost(host, target)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <Button
          variant="ghost"
          size="sm"
          className="self-start rounded-none text-xs text-muted-foreground"
          onClick={onClosePane}
        >
          <X className="size-3" />
          {t("splitScreen.closePane")}
        </Button>
      </div>
    </div>
  );
}
