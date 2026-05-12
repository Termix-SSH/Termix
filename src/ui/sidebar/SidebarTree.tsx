import { useState } from "react";
import {
  Box,
  ChevronRight,
  Cpu,
  FolderOpen,
  FolderSearch,
  MemoryStick,
  Monitor,
  Network,
  Pencil,
  Server,
  Terminal,
} from "lucide-react";
import type { Host, HostFolder, TabType } from "@/types/ui-types";

export function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

function getSshActions(
  host: Host,
): { type: TabType; icon: typeof Terminal; label: string }[] {
  const metricsEnabled = host.statsConfig?.metricsEnabled !== false;
  return [
    host.enableTerminal && {
      type: "terminal" as TabType,
      icon: Terminal,
      label: "Terminal",
    },
    host.enableFileManager && {
      type: "files" as TabType,
      icon: FolderSearch,
      label: "Files",
    },
    host.enableDocker && {
      type: "docker" as TabType,
      icon: Box,
      label: "Docker",
    },
    host.enableTunnel && {
      type: "tunnel" as TabType,
      icon: Network,
      label: "Tunnel",
    },
    metricsEnabled && {
      type: "stats" as TabType,
      icon: Server,
      label: "Stats",
    },
  ].filter(Boolean) as {
    type: TabType;
    icon: typeof Terminal;
    label: string;
  }[];
}

function hostMatchesQuery(host: Host, query: string) {
  return (
    host.name.toLowerCase().includes(query) ||
    host.ip.toLowerCase().includes(query) ||
    host.username.toLowerCase().includes(query) ||
    host.tags?.some((t) => t.toLowerCase().includes(query))
  );
}

function folderHasMatch(folder: HostFolder, query: string): boolean {
  for (const child of folder.children) {
    if (isFolder(child)) {
      if (folderHasMatch(child, query)) return true;
    } else {
      if (hostMatchesQuery(child, query)) return true;
    }
  }
  return false;
}

// Walks the visible tree in render order and pushes every visible row
// (folder header + hosts) into `out`. This gives us a flat ordered list
// to assign a single global stripe counter across folders and hosts.
function collectVisibleRows(
  children: (Host | HostFolder)[],
  query: string,
  openSet: Set<string>,
  out: (Host | HostFolder)[] = [],
): (Host | HostFolder)[] {
  for (const child of children) {
    if (isFolder(child)) {
      const visible = query ? folderHasMatch(child, query) : true;
      if (!visible) continue;
      out.push(child); // folder header row counts
      const childOpen = query ? true : openSet.has(child.name);
      if (childOpen) collectVisibleRows(child.children, query, openSet, out);
    } else {
      if (!query || hostMatchesQuery(child, query)) out.push(child);
    }
  }
  return out;
}

function folderHostCount(folder: HostFolder): {
  total: number;
  online: number;
} {
  let total = 0,
    online = 0;
  for (const child of folder.children) {
    if (isFolder(child)) {
      const c = folderHostCount(child);
      total += c.total;
      online += c.online;
    } else {
      total++;
      if (child.online) online++;
    }
  }
  return { total, online };
}

export function HostItem({
  host,
  onOpenTab,
  onEditHost,
  query = "",
  stripeIndex = 0,
}: {
  host: Host;
  onOpenTab: (type: TabType) => void;
  onEditHost?: () => void;
  query?: string;
  stripeIndex?: number;
}) {
  const [hovered, setHovered] = useState(false);

  if (query && !hostMatchesQuery(host, query)) return null;

  return (
    <div
      className={`relative flex items-stretch cursor-pointer select-none transition-colors hover:bg-muted/40 ${stripeIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpenTab("terminal")}
    >
      {/* Status stripe */}
      <div
        className={`w-[3px] shrink-0 transition-colors ${host.online ? "bg-accent-brand" : "bg-transparent"}`}
      />

      <div className="flex flex-col flex-1 min-w-0 px-2.5 pt-2 pb-1.5 gap-1">
        {/* Name + dot */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`size-1.5 rounded-full shrink-0 ${host.online ? "bg-accent-brand" : "bg-muted-foreground/25"}`}
          />
          <span className="text-[13px] font-medium truncate text-foreground leading-none">
            {host.name}
          </span>
        </div>
        {/* Address — only visible on hover */}
        <span
          className={`text-[11px] text-muted-foreground/55 truncate leading-none pl-3 transition-opacity duration-100 ${hovered ? "opacity-100" : "opacity-0 h-0 overflow-hidden"}`}
        >
          {host.username}@{host.ip}
        </span>

        {/* Action tray — slides open on hover */}
        <div
          className="overflow-hidden transition-all duration-150 ease-out"
          style={{
            maxHeight: hovered ? "200px" : "0px",
            opacity: hovered ? 1 : 0,
          }}
        >
          {host.online && (host.cpu != null || host.ram != null) && (
            <div className="flex items-center gap-3 pl-3">
              {host.cpu != null && (
                <div className="flex items-center gap-1">
                  <Cpu className="size-2.5 shrink-0 text-muted-foreground/30" />
                  <div className="w-9 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${host.cpu > 80 ? "bg-red-400" : host.cpu > 50 ? "bg-yellow-400" : "bg-accent-brand"}`}
                      style={{ width: `${host.cpu}%` }}
                    />
                  </div>
                  <span className="text-[9px] tabular-nums text-muted-foreground/40">
                    {host.cpu}%
                  </span>
                </div>
              )}
              {host.ram != null && (
                <div className="flex items-center gap-1">
                  <MemoryStick className="size-2.5 shrink-0 text-muted-foreground/30" />
                  <div className="w-9 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${host.ram > 80 ? "bg-red-400" : host.ram > 60 ? "bg-yellow-400" : "bg-accent-brand/60"}`}
                      style={{ width: `${host.ram}%` }}
                    />
                  </div>
                  <span className="text-[9px] tabular-nums text-muted-foreground/40">
                    {host.ram}%
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center flex-wrap gap-1 pt-1.5 pl-2 pb-1">
            {host.enableSsh &&
              getSshActions(host).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTab(type);
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
            {host.enableSsh &&
              (host.enableRdp || host.enableVnc || host.enableTelnet) && (
                <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
              )}
            {host.enableRdp && (
              <button
                title="RDP"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTab("rdp");
                }}
                className="flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
              >
                <Monitor className="size-3" />
                RDP
              </button>
            )}
            {host.enableVnc && (
              <button
                title="VNC"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTab("vnc");
                }}
                className="flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
              >
                <Monitor className="size-3" />
                VNC
              </button>
            )}
            {host.enableTelnet && (
              <button
                title="Telnet"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenTab("telnet");
                }}
                className="flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
              >
                <Terminal className="size-3" />
                Telnet
              </button>
            )}
            {onEditHost && (
              <>
                <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
                <button
                  title="Edit Host"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditHost();
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FolderItem({
  folder,
  depth = 0,
  onOpenTab,
  onEditHost,
  query = "",
  stripeMap,
  openFolders,
  onToggleFolder,
}: {
  folder: HostFolder;
  depth?: number;
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost?: (host: Host) => void;
  query?: string;
  stripeMap: Map<Host | HostFolder, number>;
  openFolders: Set<string>;
  onToggleFolder: (name: string) => void;
}) {
  const { total, online } = folderHostCount(folder);

  if (query && !folderHasMatch(folder, query)) return null;

  const isOpen = query ? true : openFolders.has(folder.name);
  const stripeIndex = stripeMap.get(folder) ?? 0;

  return (
    <div>
      <button
        onClick={() => !query && onToggleFolder(folder.name)}
        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors text-left cursor-pointer ${stripeIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
        <FolderOpen
          className={`size-3.5 shrink-0 ${isOpen ? "text-accent-brand" : "text-muted-foreground/60"}`}
        />
        <span className="text-[13px] font-semibold text-foreground/80 truncate flex-1">
          {folder.name}
        </span>
        <span className="text-[10px] tabular-nums shrink-0 ml-1">
          {online > 0 && (
            <span className="text-accent-brand font-semibold">{online}</span>
          )}
          <span className="text-muted-foreground/40">/{total}</span>
        </span>
      </button>
      {isOpen && (
        <div className="border-l border-border/40 ml-[30px]">
          {folder.children.map((child, i) =>
            isFolder(child) ? (
              <FolderItem
                key={i}
                folder={child}
                depth={depth + 1}
                onOpenTab={onOpenTab}
                onEditHost={onEditHost}
                query={query}
                stripeMap={stripeMap}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
              />
            ) : (
              <HostItem
                key={i}
                host={child}
                onOpenTab={(t) => onOpenTab(child, t)}
                onEditHost={onEditHost ? () => onEditHost(child) : undefined}
                query={query}
                stripeIndex={stripeMap.get(child) ?? 0}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

// Top-level tree renderer — owns open state and global stripe index.
export function SidebarTree({
  children,
  onOpenTab,
  onEditHost,
  query = "",
}: {
  children: (Host | HostFolder)[];
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  query?: string;
}) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());

  function toggleFolder(name: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  const visibleRows = collectVisibleRows(children, query, openFolders);
  const stripeMap = new Map<Host | HostFolder, number>(
    visibleRows.map((r, i) => [r, i]),
  );

  return (
    <>
      {children.map((child, i) =>
        isFolder(child) ? (
          <FolderItem
            key={i}
            folder={child}
            onOpenTab={onOpenTab}
            onEditHost={onEditHost}
            query={query}
            stripeMap={stripeMap}
            openFolders={openFolders}
            onToggleFolder={toggleFolder}
          />
        ) : (
          <HostItem
            key={i}
            host={child}
            onOpenTab={(t) => onOpenTab(child, t)}
            onEditHost={() => onEditHost(child)}
            query={query}
            stripeIndex={stripeMap.get(child) ?? 0}
          />
        ),
      )}
    </>
  );
}
