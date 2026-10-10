import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Globe,
  KeyRound,
  Plus,
  Server,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/empty-state";
import { PanelSearch } from "@/components/panel-layout";
import { cn } from "@/lib/utils";
import { rem } from "@/lib/rem";
import type { Credential, Host } from "@/types/ui-types";
import { defaultsRows, type DefaultsRow } from "./defaults-rows";
import {
  allFolderPaths,
  allParentIds,
  buildCredentialManageTree,
  buildHostManageTree,
  flattenTree,
  type ManageRow,
} from "./manage-tree";
import type { ManageMode } from "./manage-requests";
import {
  getStatusClasses,
  useStatusColorScheme,
} from "@/hooks/use-status-color-scheme";

function indent(depth: number) {
  return 6 + depth * 13;
}

/** Rules marking each open ancestor, so deep rows still read as nested. */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: rem(indent(i) + 7) }}
        />
      ))}
    </>
  );
}

const rowFocus =
  "focus-visible:relative focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-ring";

/** The list column of the Manage tab. */
export function ManageList({
  editing,
  mode,
  onMode,
  hosts,
  credentials,
  canEditInstanceDefaults,
  isOnline,
  selectedKey,
  onPickHost,
  onPickCredential,
  onPickDefaults,
  onAdd,
}: {
  editing: boolean;
  mode: ManageMode;
  onMode: (mode: ManageMode) => void;
  hosts: Host[];
  credentials: Credential[];
  canEditInstanceDefaults: boolean;
  isOnline: (host: Host) => boolean;
  /** "h:<id>", "c:<id>" or a defaults row key. */
  selectedKey: string | null;
  onPickHost: (host: Host) => void;
  onPickCredential: (credential: Credential) => void;
  onPickDefaults: (row: DefaultsRow) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const tree = useMemo(
    () =>
      mode === "credentials"
        ? buildCredentialManageTree(credentials)
        : buildHostManageTree(hosts, isOnline),
    [mode, hosts, credentials, isOnline],
  );

  // Everything starts open; closing something is remembered while mounted.
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    setOpen(new Set([...allFolderPaths(tree), ...allParentIds(tree)]));
    // Rebuilt only when the side changes, so toggles survive an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rows = useMemo(
    () => (mode === "defaults" ? [] : flattenTree(tree, open, needle)),
    [mode, tree, open, needle],
  );

  const defaults = useMemo(
    () =>
      defaultsRows(hosts, canEditInstanceDefaults, t).filter(
        (row) => !needle || row.label.toLowerCase().includes(needle),
      ),
    [hosts, canEditInstanceDefaults, t, needle],
  );

  const pick = (id: string) => {
    if (mode === "hosts") {
      const host = hosts.find((h) => h.id === id);
      if (host) onPickHost(host);
    } else {
      const credential = credentials.find((c) => c.id === id);
      if (credential) onPickCredential(credential);
    }
  };

  const empty = mode === "defaults" ? defaults.length === 0 : rows.length === 0;

  return (
    <div
      className={cn(
        editing ? "hidden md:flex" : "flex",
        "w-full shrink-0 flex-col border-r border-border bg-background md:w-72",
      )}
    >
      <nav
        aria-label={t("manage.sections")}
        className="flex shrink-0 flex-col border-b border-border py-1"
      >
        {(
          [
            {
              value: "hosts",
              label: t("nav.hosts"),
              icon: Server,
              count: hosts.length,
            },
            {
              value: "credentials",
              label: t("nav.credentials"),
              icon: KeyRound,
              count: credentials.length,
            },
            {
              value: "defaults",
              label: t("manage.defaults"),
              icon: SlidersHorizontal,
            },
          ] as {
            value: ManageMode;
            label: string;
            icon: typeof Server;
            count?: number;
          }[]
        ).map((item) => {
          const active = item.value === mode;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onMode(item.value)}
              className={cn(
                "flex w-full items-center gap-2 border-l-2 py-1.5 pl-2 pr-2.5 text-left transition-colors",
                rowFocus,
                active
                  ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {item.label}
              </span>
              {item.count !== undefined && (
                <span className="shrink-0 text-[10px] tabular-nums opacity-60">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col gap-2 border-b border-border px-2.5 py-2">
        <div className="flex items-center gap-2">
          <PanelSearch
            value={query}
            onChange={setQuery}
            placeholder={
              mode === "hosts"
                ? t("manage.searchHosts")
                : mode === "credentials"
                  ? t("manage.searchCredentials")
                  : t("manage.searchDefaults")
            }
            fill
          />
          {mode !== "defaults" && (
            <Button
              variant="outline"
              size="icon"
              title={
                mode === "hosts"
                  ? t("hosts.addHost")
                  : t("manage.addCredential")
              }
              aria-label={
                mode === "hosts"
                  ? t("hosts.addHost")
                  : t("manage.addCredential")
              }
              onClick={onAdd}
              className="shrink-0 border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1 thin-scrollbar">
        {empty ? (
          <EmptyState
            icon={mode === "credentials" ? KeyRound : Server}
            title={needle ? t("manage.nothingMatches") : t("manage.nothingYet")}
            hint={
              needle
                ? undefined
                : mode === "hosts"
                  ? t("manage.emptyHostsHint")
                  : t("manage.emptyCredentialsHint")
            }
          />
        ) : mode === "defaults" ? (
          defaults.map((row) => {
            const Icon =
              row.level === "admin"
                ? Globe
                : row.level === "user"
                  ? User
                  : Folder;
            const selected = selectedKey === row.key;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onPickDefaults(row)}
                className={cn(
                  "flex w-full items-center gap-2 border-l-2 px-2.5 py-1.5 text-left transition-colors",
                  rowFocus,
                  selected
                    ? "border-accent-brand bg-accent-brand/10 text-accent-brand"
                    : "border-transparent text-foreground hover:bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    !selected && "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {row.label}
                </span>
                <SlidersHorizontal className="size-3 shrink-0 text-muted-foreground/60" />
              </button>
            );
          })
        ) : (
          rows.map((row) =>
            row.kind === "folder" ? (
              <FolderRow
                key={`f:${row.folder.path}`}
                row={row}
                showOnline={mode === "hosts"}
                open={!!needle || open.has(row.folder.path)}
                locked={!!needle}
                onToggle={() => toggle(row.folder.path)}
              />
            ) : (
              <ItemRow
                key={`i:${row.item.id}`}
                row={row}
                isHost={mode === "hosts"}
                selected={
                  selectedKey ===
                  `${mode === "hosts" ? "h" : "c"}:${row.item.id}`
                }
                open={!!needle || open.has(row.item.id)}
                locked={!!needle}
                onToggle={() => toggle(row.item.id)}
                onPick={() => pick(row.item.id)}
              />
            ),
          )
        )}
      </div>
    </div>
  );
}

function FolderRow({
  row,
  open,
  locked,
  showOnline,
  onToggle,
}: {
  row: Extract<ManageRow, { kind: "folder" }>;
  open: boolean;
  /** Search forces folders open, so the chevron stops responding. */
  locked: boolean;
  showOnline: boolean;
  onToggle: () => void;
}) {
  const Icon = open ? FolderOpen : Folder;
  return (
    <div className="relative">
      <Guides depth={row.depth} />
      <button
        type="button"
        aria-expanded={open}
        onClick={locked ? undefined : onToggle}
        style={{ paddingLeft: rem(indent(row.depth)) }}
        className={cn(
          "group flex w-full items-center gap-1.5 py-1.5 pr-2.5 text-left transition-colors hover:bg-muted",
          rowFocus,
        )}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {row.folder.name}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
          {showOnline ? `${row.online}/${row.count}` : row.count}
        </span>
      </button>
    </div>
  );
}

function ItemRow({
  row,
  isHost,
  selected,
  open,
  locked,
  onToggle,
  onPick,
}: {
  row: Extract<ManageRow, { kind: "item" }>;
  isHost: boolean;
  selected: boolean;
  open: boolean;
  locked: boolean;
  onToggle: () => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useStatusColorScheme();
  const nests = row.item.children.length > 0;
  const Icon = isHost ? Server : KeyRound;

  return (
    <div className="relative">
      <Guides depth={row.depth} />
      <div
        className={cn(
          "flex items-center border-l-2 transition-colors",
          selected
            ? "border-accent-brand bg-accent-brand/10"
            : "border-transparent hover:bg-muted",
        )}
      >
        <div
          className="flex shrink-0 items-center justify-center"
          style={{ paddingLeft: rem(indent(row.depth)) }}
        >
          {nests ? (
            <button
              type="button"
              onClick={locked ? undefined : onToggle}
              aria-expanded={open}
              title={open ? t("manage.collapse") : t("manage.expand")}
              aria-label={open ? t("manage.collapse") : t("manage.expand")}
              className={cn(
                "flex size-4 items-center justify-center text-muted-foreground hover:text-foreground",
                rowFocus,
              )}
            >
              {open ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
            </button>
          ) : (
            <span aria-hidden className="size-4" />
          )}
        </div>

        <button
          type="button"
          onClick={onPick}
          aria-current={selected ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-2.5 text-left transition-colors",
            rowFocus,
            selected ? "text-accent-brand" : "text-foreground",
          )}
        >
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              !selected && "text-muted-foreground",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {row.item.name}
          </span>
          <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
            {row.item.note}
          </span>
          {isHost && (
            <span
              aria-hidden
              title={row.item.online ? t("common.online") : t("common.offline")}
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                getStatusClasses(!!row.item.online, scheme, "dot"),
              )}
            />
          )}
        </button>
      </div>
    </div>
  );
}
