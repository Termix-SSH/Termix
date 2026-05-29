import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { SidebarTree } from "@/sidebar/SidebarTree";
import { HostManager } from "@/sidebar/HostManager";
import { HostShareModal } from "@/sidebar/HostShareModal";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { getSSHHosts, bulkImportSSHHosts } from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";
import type { Host, HostFolder, TabType } from "@/types/ui-types";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importOverwriteRef = useRef(false);

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

  function handleExportHosts() {
    const data = JSON.stringify({ hosts: rawHosts }, null, 2);
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
                const normalized = hostsArray.map((h: any) => ({
                  ...h,
                  port: h.port ?? h.sshPort ?? 22,
                  enableSsh: h.enableSsh ?? h.connectionType === "ssh",
                  enableRdp: h.enableRdp ?? h.connectionType === "rdp",
                  enableVnc: h.enableVnc ?? h.connectionType === "vnc",
                  enableTelnet: h.enableTelnet ?? h.connectionType === "telnet",
                }));
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
              } catch (err: any) {
                toast.error(err?.message ?? "Failed to import hosts");
              }
            }}
          />

          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 flex-1">
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
          children={hostTree?.children ?? []}
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
