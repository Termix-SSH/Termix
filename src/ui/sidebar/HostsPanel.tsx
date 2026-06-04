import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpDown,
  Check,
  Download,
  Filter,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SidebarTree, isFolder } from "@/sidebar/SidebarTree";
import { HostManager } from "@/sidebar/HostManager";
import { HostShareModal } from "@/sidebar/HostShareModal";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import {
  getSSHHosts,
  bulkImportSSHHosts,
  exportAllSSHHosts,
} from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";
import type { Host, HostFolder, TabType } from "@/types/ui-types";

type SortKey =
  | "default"
  | "name-asc"
  | "name-desc"
  | "ip-asc"
  | "ip-desc"
  | "status-online"
  | "status-offline"
  | "pinned";

type FilterState = {
  status: ("online" | "offline" | "pinned")[];
  authType: ("password" | "key" | "credential" | "none" | "opkssh")[];
  protocol: ("ssh" | "rdp" | "vnc" | "telnet")[];
  features: ("terminal" | "fileManager" | "tunnel" | "docker")[];
  tags: string[];
};

const DEFAULT_FILTERS: FilterState = {
  status: [],
  authType: [],
  protocol: [],
  features: [],
  tags: [],
};

function sortHostTree(folder: HostFolder, key: SortKey): HostFolder {
  if (key === "default") return folder;

  const comparator = (a: Host | HostFolder, b: Host | HostFolder): number => {
    const aIsFolder = isFolder(a);
    const bIsFolder = isFolder(b);
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    if (aIsFolder && bIsFolder)
      return (a as HostFolder).name.localeCompare((b as HostFolder).name);
    const ha = a as Host,
      hb = b as Host;
    switch (key) {
      case "name-asc":
        return ha.name.localeCompare(hb.name);
      case "name-desc":
        return hb.name.localeCompare(ha.name);
      case "ip-asc":
        return ha.ip.localeCompare(hb.ip);
      case "ip-desc":
        return hb.ip.localeCompare(ha.ip);
      case "status-online":
        return (hb.online ? 1 : 0) - (ha.online ? 1 : 0);
      case "status-offline":
        return (ha.online ? 1 : 0) - (hb.online ? 1 : 0);
      case "pinned":
        return (hb.pin ? 1 : 0) - (ha.pin ? 1 : 0);
    }
    return 0;
  };

  const sortedChildren = [...folder.children]
    .sort(comparator)
    .map((child) => (isFolder(child) ? sortHostTree(child, key) : child));
  return { ...folder, children: sortedChildren };
}

function hostPassesFilters(host: Host, filters: FilterState): boolean {
  if (filters.status.length > 0) {
    const ok =
      (filters.status.includes("online") && host.online) ||
      (filters.status.includes("offline") && !host.online) ||
      (filters.status.includes("pinned") && !!host.pin);
    if (!ok) return false;
  }
  if (filters.authType.length > 0) {
    if (
      !filters.authType.includes(
        host.authType as FilterState["authType"][number],
      )
    )
      return false;
  }
  if (filters.protocol.length > 0) {
    const ok =
      (filters.protocol.includes("ssh") && host.enableSsh) ||
      (filters.protocol.includes("rdp") && host.enableRdp) ||
      (filters.protocol.includes("vnc") && host.enableVnc) ||
      (filters.protocol.includes("telnet") && host.enableTelnet);
    if (!ok) return false;
  }
  if (filters.features.length > 0) {
    const ok =
      (filters.features.includes("terminal") && host.enableTerminal) ||
      (filters.features.includes("fileManager") && host.enableFileManager) ||
      (filters.features.includes("tunnel") && host.enableTunnel) ||
      (filters.features.includes("docker") && host.enableDocker);
    if (!ok) return false;
  }
  if (filters.tags.length > 0) {
    const ok = filters.tags.some((tag) => host.tags?.includes(tag));
    if (!ok) return false;
  }
  return true;
}

function applyFilters(folder: HostFolder, filters: FilterState): HostFolder {
  const active = Object.values(filters).some((arr) => arr.length > 0);
  if (!active) return folder;

  const filteredChildren = folder.children
    .map((child) => {
      if (isFolder(child)) return applyFilters(child, filters);
      return hostPassesFilters(child, filters) ? child : null;
    })
    .filter((child): child is Host | HostFolder => {
      if (child === null) return false;
      if (isFolder(child)) return child.children.length > 0;
      return true;
    });
  return { ...folder, children: filteredChildren };
}

export function HostsPanel({
  onOpenTab,
  onEditHost,
  hostTree,
  loading,
  onEditingChange,
  active = true,
}: {
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  hostTree?: HostFolder;
  loading?: boolean;
  onEditingChange?: (editing: boolean) => void;
  active?: boolean;
}) {
  const { t } = useTranslation();
  const [hostSearch, setHostSearch] = useState("");
  const [managerEditing, setManagerEditing] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rawHosts, setRawHosts] = useState<SSHHostWithStatus[]>([]);
  const [shareModalHost, setShareModalHost] = useState<Host | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(
    () => (localStorage.getItem("hostSortKey") as SortKey) ?? "default",
  );
  const [filterState, setFilterState] = useState<FilterState>(() => {
    try {
      const saved = localStorage.getItem("hostFilterState");
      return saved ? (JSON.parse(saved) as FilterState) : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const filterActive = Object.values(filterState).some((arr) => arr.length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importOverwriteRef = useRef(false);
  const allTags = [...new Set(rawHosts.flatMap((h) => h.tags ?? []))];

  function handleSortChange(key: SortKey) {
    setSortKey(key);
    localStorage.setItem("hostSortKey", key);
  }

  function handleFilterToggle<K extends keyof FilterState>(
    group: K,
    value: FilterState[K][number],
  ) {
    setFilterState((prev) => {
      const arr = prev[group] as string[];
      const next = arr.includes(value as string)
        ? arr.filter((v) => v !== value)
        : [...arr, value as string];
      const updated = { ...prev, [group]: next };
      localStorage.setItem("hostFilterState", JSON.stringify(updated));
      return updated as FilterState;
    });
  }

  function handleFilterClear() {
    setFilterState(DEFAULT_FILTERS);
    localStorage.setItem("hostFilterState", JSON.stringify(DEFAULT_FILTERS));
  }

  useEffect(() => {
    getSSHHosts()
      .then(setRawHosts)
      .catch(() => {});
  }, []);

  function handleEditingChange(editing: boolean) {
    setManagerEditing(editing);
    onEditingChange?.(editing);
  }

  function toggleSelectionMode() {
    setSelectionMode((v) => !v);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const hosts = await getSSHHosts();
      setRawHosts(hosts);
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
    } catch {
      // best-effort
    } finally {
      setRefreshing(false);
    }
  }

  async function handleExportHosts() {
    try {
      const result = await exportAllSSHHosts();
      const data = JSON.stringify(result, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "termix-hosts.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("hosts.hostsExported"));
    } catch {
      toast.error(t("hosts.exportFailed"));
    }
  }

  function handleDownloadSample() {
    const sample = JSON.stringify(
      {
        hosts: [
          {
            name: "Web Server (Production)",
            ip: "192.168.1.100",
            username: "admin",
            authType: "password",
            password: "your_secure_password_here",
            folder: "Production",
            tags: ["web", "production", "nginx"],
            pin: true,
            notes: "Main production web server running Nginx",
            enableSsh: true,
            enableRdp: false,
            enableVnc: false,
            enableTelnet: false,
            sshPort: 22,
            enableTerminal: true,
            enableTunnel: false,
            enableFileManager: true,
            enableDocker: false,
            defaultPath: "/var/www",
          },
          {
            name: "Database Server",
            ip: "192.168.1.101",
            username: "dbadmin",
            authType: "key",
            key: "-----BEGIN OPENSSH PRIVATE KEY-----\nYour SSH private key content here\n-----END OPENSSH PRIVATE KEY-----",
            keyPassword: "optional_key_passphrase",
            keyType: "ssh-ed25519",
            folder: "Production",
            tags: ["database", "production", "postgresql"],
            enableSsh: true,
            enableRdp: false,
            enableVnc: false,
            enableTelnet: false,
            sshPort: 22,
            enableTerminal: true,
            enableTunnel: true,
            enableFileManager: false,
            enableDocker: false,
          },
        ],
      },
      null,
      2,
    );
    const blob = new Blob([sample], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "termix-hosts-sample.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {!managerEditing && (
        <div className="flex flex-col px-2 py-1.5 shrink-0 border-b border-border/60 gap-1.5">
          <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60 rounded-sm">
            <Search className="size-3 text-muted-foreground/60 shrink-0" />
            <input
              value={hostSearch}
              onChange={(e) => setHostSearch(e.target.value)}
              placeholder={t("hosts.searchHosts")}
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
            />
            {hostSearch && (
              <button
                onClick={() => setHostSearch("")}
                className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                const hostsArray = Array.isArray(parsed)
                  ? parsed
                  : (parsed.hosts ?? []);
                if (!Array.isArray(hostsArray) || hostsArray.length === 0) {
                  toast.error("No hosts found in file");
                  return;
                }
                if (hostsArray.length > 100) {
                  toast.error("Cannot import more than 100 hosts at once");
                  return;
                }
                const normalized = hostsArray.map(
                  (h: Record<string, unknown>) => ({
                    ...h,
                    port: h.port ?? h.sshPort ?? 22,
                    enableSsh: h.enableSsh ?? h.connectionType === "ssh",
                    enableRdp: h.enableRdp ?? h.connectionType === "rdp",
                    enableVnc: h.enableVnc ?? h.connectionType === "vnc",
                    enableTelnet:
                      h.enableTelnet ?? h.connectionType === "telnet",
                  }),
                );
                const result = await bulkImportSSHHosts(
                  normalized,
                  importOverwriteRef.current,
                );
                const hosts = await getSSHHosts();
                setRawHosts(hosts);
                window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
                const msg = [
                  result.success ? `${result.success} imported` : null,
                  result.updated ? `${result.updated} updated` : null,
                  result.failed ? `${result.failed} failed` : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                toast.success(`Import complete: ${msg}`);
              } catch (err: unknown) {
                toast.error(
                  err instanceof Error ? err.message : "Failed to import hosts",
                );
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-1">
            <div className="flex items-center gap-0.5 shrink-0 flex-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                title={t("hosts.refreshBtn2")}
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    title={t("hosts.importExportBtn")}
                  >
                    <Upload className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="text-xs">
                  <DropdownMenuItem
                    onClick={() => {
                      importOverwriteRef.current = false;
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5 mr-2" />
                    {t("hosts.importSkipExisting")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      importOverwriteRef.current = true;
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5 mr-2" />
                    {t("hosts.importOverwrite")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleExportHosts}
                    disabled={rawHosts.length === 0}
                  >
                    <Download className="size-3.5 mr-2" />
                    {t("hosts.exportAll")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadSample}>
                    <Download className="size-3.5 mr-2" />
                    {t("hosts.downloadSample")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                title={
                  selectionMode
                    ? t("hosts.exitSelectionTitle")
                    : t("hosts.selectHosts")
                }
                onClick={toggleSelectionMode}
                className={`flex items-center justify-center size-7 rounded-sm shrink-0 transition-colors ${selectionMode ? "text-accent-brand bg-accent-brand/10 border border-accent-brand/30" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 border border-transparent"}`}
              >
                <ListChecks className="size-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`size-7 ${sortKey !== "default" ? "text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("hosts.sortHosts")}
                  >
                    <ArrowUpDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="text-xs min-w-[160px]"
                >
                  <DropdownMenuItem
                    onClick={() => handleSortChange("default")}
                    className="flex items-center gap-1.5"
                  >
                    {sortKey === "default" ? (
                      <Check className="size-3 shrink-0 text-accent-brand" />
                    ) : (
                      <span className="size-3 shrink-0 inline-block" />
                    )}
                    {t("hosts.sortDefault")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {(["name-asc", "name-desc"] as const).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => handleSortChange(key)}
                      className="flex items-center gap-1.5"
                    >
                      {sortKey === key ? (
                        <Check className="size-3 shrink-0 text-accent-brand" />
                      ) : (
                        <span className="size-3 shrink-0 inline-block" />
                      )}
                      {t(
                        `hosts.sort${key === "name-asc" ? "NameAsc" : "NameDesc"}`,
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {(["ip-asc", "ip-desc"] as const).map((key) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => handleSortChange(key)}
                      className="flex items-center gap-1.5"
                    >
                      {sortKey === key ? (
                        <Check className="size-3 shrink-0 text-accent-brand" />
                      ) : (
                        <span className="size-3 shrink-0 inline-block" />
                      )}
                      {t(`hosts.sort${key === "ip-asc" ? "IpAsc" : "IpDesc"}`)}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {(["status-online", "status-offline", "pinned"] as const).map(
                    (key) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => handleSortChange(key)}
                        className="flex items-center gap-1.5"
                      >
                        {sortKey === key ? (
                          <Check className="size-3 shrink-0 text-accent-brand" />
                        ) : (
                          <span className="size-3 shrink-0 inline-block" />
                        )}
                        {t(
                          key === "status-online"
                            ? "hosts.sortOnlineFirst"
                            : key === "status-offline"
                              ? "hosts.sortOfflineFirst"
                              : "hosts.sortPinnedFirst",
                        )}
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`size-7 ${filterActive ? "text-accent-brand" : "text-muted-foreground hover:text-foreground"}`}
                    title={t("hosts.filterHosts")}
                  >
                    <Filter className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="text-xs min-w-[180px]"
                >
                  {filterActive && (
                    <>
                      <DropdownMenuItem
                        onClick={handleFilterClear}
                        className="flex items-center gap-1.5 text-accent-brand"
                      >
                        <X className="size-3 shrink-0" />
                        {t("hosts.filterClearAll")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuLabel>
                    {t("hosts.filterStatusGroup")}
                  </DropdownMenuLabel>
                  {(["online", "offline", "pinned"] as const).map((val) => (
                    <DropdownMenuCheckboxItem
                      key={val}
                      checked={filterState.status.includes(val)}
                      onCheckedChange={() => handleFilterToggle("status", val)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {t(
                        `hosts.filter${val.charAt(0).toUpperCase() + val.slice(1)}`,
                      )}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    {t("hosts.filterAuthGroup")}
                  </DropdownMenuLabel>
                  {(
                    ["password", "key", "credential", "none", "opkssh"] as const
                  ).map((val) => (
                    <DropdownMenuCheckboxItem
                      key={val}
                      checked={filterState.authType.includes(val)}
                      onCheckedChange={() =>
                        handleFilterToggle("authType", val)
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {t(
                        `hosts.filterAuth${val.charAt(0).toUpperCase() + val.slice(1)}`,
                      )}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    {t("hosts.filterProtocolGroup")}
                  </DropdownMenuLabel>
                  {(
                    [
                      ["ssh", "Ssh"],
                      ["rdp", "Rdp"],
                      ["vnc", "Vnc"],
                      ["telnet", "Telnet"],
                    ] as const
                  ).map(([val, key]) => (
                    <DropdownMenuCheckboxItem
                      key={val}
                      checked={filterState.protocol.includes(val)}
                      onCheckedChange={() =>
                        handleFilterToggle("protocol", val)
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {t(`hosts.filterProtocol${key}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>
                    {t("hosts.filterFeaturesGroup")}
                  </DropdownMenuLabel>
                  {(
                    [
                      ["terminal", "Terminal"],
                      ["fileManager", "FileManager"],
                      ["tunnel", "Tunnel"],
                      ["docker", "Docker"],
                    ] as const
                  ).map(([val, key]) => (
                    <DropdownMenuCheckboxItem
                      key={val}
                      checked={filterState.features.includes(val)}
                      onCheckedChange={() =>
                        handleFilterToggle("features", val)
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      {t(`hosts.filterFeature${key}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {allTags.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>
                        {t("hosts.filterTagsGroup")}
                      </DropdownMenuLabel>
                      {allTags.map((tag) => (
                        <DropdownMenuCheckboxItem
                          key={tag}
                          checked={filterState.tags.includes(tag)}
                          onCheckedChange={() =>
                            handleFilterToggle("tags", tag)
                          }
                          onSelect={(e) => e.preventDefault()}
                        >
                          {tag}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent("host-manager:add-host"))
              }
              title={t("hosts.addHost")}
              className="flex items-center gap-1 h-7 px-2 text-[10px] font-medium text-accent-brand hover:bg-accent-brand/10 border border-accent-brand/30 rounded-sm shrink-0 transition-colors"
            >
              <Plus className="size-3 shrink-0" />
              {t("hosts.addHost")}
            </button>
          </div>
        </div>
      )}

      <div
        className={`flex flex-col flex-1 min-h-0 ${managerEditing ? "hidden" : ""}`}
      >
        <SidebarTree
          children={
            hostTree
              ? applyFilters(sortHostTree(hostTree, sortKey), filterState)
                  .children
              : []
          }
          onOpenTab={onOpenTab}
          onEditHost={onEditHost}
          onShareHost={(host) => setShareModalHost(host)}
          query={hostSearch.trim().toLowerCase()}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
          loading={loading}
        />
      </div>

      <div
        className={managerEditing ? "flex flex-col flex-1 min-h-0" : "hidden"}
      >
        <HostManager onEditingChange={handleEditingChange} active={active} />
      </div>

      <HostShareModal
        open={shareModalHost !== null}
        onClose={() => setShareModalHost(null)}
        host={shareModalHost}
      />
    </div>
  );
}
