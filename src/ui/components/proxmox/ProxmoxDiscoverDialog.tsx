import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Server, RefreshCw, CheckSquare, Square, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select";
import {
  discoverProxmoxGuests,
  bulkImportSSHHosts,
  getSSHHosts,
} from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";
import type { ProxmoxGuest } from "@/types/proxmox";

interface ProxmoxDiscoverDialogProps {
  open: boolean;
  onClose: () => void;
  hosts: SSHHostWithStatus[];
  onHostsChanged: (hosts: SSHHostWithStatus[]) => void;
  /** Pre-select a specific host and skip the host picker */
  preselectedHostId?: number;
  /** Credential to use for imported hosts */
  defaultCredentialId?: number | null;
  /** Auth type to use for imported hosts */
  defaultAuthType?: string;
  /** Username from the default credential */
  defaultUsername?: string;
}

export function ProxmoxDiscoverDialog({
  open,
  onClose,
  hosts,
  onHostsChanged,
  preselectedHostId,
  defaultCredentialId,
  defaultAuthType,
  defaultUsername,
}: ProxmoxDiscoverDialogProps) {
  const { t } = useTranslation();
  const [selectedHostId, setSelectedHostId] = useState<string>(
    preselectedHostId ? String(preselectedHostId) : "",
  );
  const [discovering, setDiscovering] = useState(false);
  const [guests, setGuests] = useState<ProxmoxGuest[] | null>(null);
  const [discoveredCredentialId, setDiscoveredCredentialId] = useState<
    number | null
  >(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);

  // When opened from the dropdown (no preselectedHostId), only show Proxmox-enabled hosts
  const sshHosts = hosts.filter(
    (h) => !("isFolder" in h) && h.enableProxmox === true,
  );

  // The Proxmox host the discovery runs against — imported guests are grouped
  // into a folder named after it. Use the same id resolution as discovery so
  // it also works when launched directly from a host action (preselectedHostId).
  const effectiveHostId =
    preselectedHostId != null ? String(preselectedHostId) : selectedHostId;
  const sourceHost = hosts.find(
    (h) => !("isFolder" in h) && String(h.id) === effectiveHostId,
  );
  const importFolder = sourceHost?.name || "Proxmox";

  function reset() {
    if (!preselectedHostId) setSelectedHostId("");
    setGuests(null);
    setDiscoveredCredentialId(null);
    setSelected(new Set());
    setDiscovering(false);
    setImporting(false);
  }

  async function handleDiscover() {
    const hostId =
      preselectedHostId ?? (selectedHostId ? Number(selectedHostId) : null);
    if (!hostId) return;
    setDiscovering(true);
    setGuests(null);
    setDiscoveredCredentialId(null);
    setSelected(new Set());
    try {
      const result = await discoverProxmoxGuests(hostId);
      setGuests(result.guests);
      setDiscoveredCredentialId(result.credentialId ?? null);
      setSelected(
        new Set(
          result.guests
            .filter((g) => g.status === "running")
            .map((g) => g.vmid),
        ),
      );
    } catch (err: any) {
      toast.error(err?.message ?? t("hosts.proxmoxDiscoveryFailed"));
    } finally {
      setDiscovering(false);
    }
  }

  async function handleImport() {
    if (!guests || selected.size === 0) return;
    setImporting(true);
    try {
      // Prefer explicitly configured credential, then fall back to the host's own credential
      const credId = defaultCredentialId ?? discoveredCredentialId;
      const resolvedAuthType =
        defaultAuthType ?? (credId != null ? "credential" : "password");

      const toImport = guests
        .filter((g) => selected.has(g.vmid))
        .map((g) => ({
          name: g.name,
          ip: g.ip ?? "0.0.0.0",
          port: g.connectionType === "rdp" ? 3389 : 22,
          username: defaultUsername ?? "root",
          folder: importFolder,
          authType: resolvedAuthType,
          ...(resolvedAuthType === "credential" && credId != null
            ? {
                credentialId: credId,
                overrideCredentialUsername: true,
              }
            : {}),
          enableTerminal: g.connectionType !== "rdp",
          enableFileManager: g.connectionType !== "rdp",
          enableTunnel: g.connectionType !== "rdp",
          enableSsh: g.connectionType !== "rdp",
          enableRdp: g.connectionType === "rdp",
          enableDocker: g.enableDocker,
          connectionType: g.connectionType,
          tags: ["proxmox", g.type, g.node],
        }));

      const result = await bulkImportSSHHosts(toImport, false);
      const updated = await getSSHHosts();
      onHostsChanged(updated);
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));

      const msg = [
        result.success
          ? t("hosts.proxmoxResultImported", { count: result.success })
          : null,
        result.updated
          ? t("hosts.proxmoxResultUpdated", { count: result.updated })
          : null,
        result.failed
          ? t("hosts.proxmoxResultFailed", { count: result.failed })
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      toast.success(t("hosts.proxmoxImportComplete", { summary: msg }));

      if (result.failed === 0) {
        reset();
        onClose();
      }
    } catch (err: any) {
      toast.error(err?.message ?? t("hosts.proxmoxImportFailed"));
    } finally {
      setImporting(false);
    }
  }

  const nodeGroups = guests
    ? guests.reduce(
        (acc, g) => {
          if (!acc[g.node]) acc[g.node] = [];
          acc[g.node].push(g);
          return acc;
        },
        {} as Record<string, ProxmoxGuest[]>,
      )
    : {};

  const canDiscover = preselectedHostId != null || !!selectedHostId;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-4" />
            {t("hosts.proxmoxImportTitle")}
          </DialogTitle>
          <a
            href="https://docs.termix.site/features/files-and-hosts/proxmox-import"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-accent-brand hover:underline"
          >
            {t("hosts.docsLink")}
          </a>
        </DialogHeader>

        <div className="space-y-3">
          {/* Host selector — hidden when launched from a specific host */}
          {!preselectedHostId && (
            <div className="flex gap-2">
              <Select
                value={selectedHostId}
                onValueChange={setSelectedHostId}
                disabled={discovering}
              >
                <SelectTrigger className="flex-1 text-xs h-8">
                  <SelectValue placeholder={t("hosts.proxmoxSelectHost")} />
                </SelectTrigger>
                <SelectContent>
                  {sshHosts.map((h) => (
                    <SelectItem
                      key={h.id}
                      value={String(h.id)}
                      className="text-xs"
                    >
                      {h.name || h.ip}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                disabled={!canDiscover || discovering}
                onClick={handleDiscover}
                className="shrink-0"
              >
                <RefreshCw
                  className={`size-3.5 mr-1.5 ${discovering ? "animate-spin" : ""}`}
                />
                {t("hosts.proxmoxDiscover")}
              </Button>
            </div>
          )}

          {/* When launched from a specific host, show Discover directly */}
          {preselectedHostId && !guests && (
            <Button
              size="sm"
              variant="outline"
              disabled={discovering}
              onClick={handleDiscover}
              className="w-full"
            >
              <RefreshCw
                className={`size-3.5 mr-1.5 ${discovering ? "animate-spin" : ""}`}
              />
              {discovering
                ? t("hosts.proxmoxDiscovering")
                : t("hosts.proxmoxDiscoverGuests")}
            </Button>
          )}

          {/* Guest list */}
          {guests !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("hosts.proxmoxGuestsSelected", {
                    count: guests.length,
                    selected: selected.size,
                  })}
                </span>
                <div className="flex gap-2">
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() =>
                      setSelected(new Set(guests.map((g) => g.vmid)))
                    }
                  >
                    {t("hosts.proxmoxSelectAll")}
                  </button>
                  <span>·</span>
                  <button
                    className="hover:text-foreground transition-colors"
                    onClick={() => setSelected(new Set())}
                  >
                    {t("hosts.proxmoxDeselectAll")}
                  </button>
                </div>
              </div>

              {guests.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  {t("hosts.proxmoxNoGuests")}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  {Object.entries(nodeGroups).map(([node, nodeGuests]) => (
                    <div key={node}>
                      <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground bg-muted/50 uppercase tracking-wider">
                        {node}
                      </div>
                      {nodeGuests.map((g) => (
                        <button
                          key={g.vmid}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                          onClick={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(g.vmid)) next.delete(g.vmid);
                              else next.add(g.vmid);
                              return next;
                            });
                          }}
                        >
                          {selected.has(g.vmid) ? (
                            <CheckSquare className="size-3.5 text-primary shrink-0" />
                          ) : (
                            <Square className="size-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex-1 truncate">{g.name}</span>
                          <span className="text-muted-foreground text-[10px] shrink-0">
                            {g.type.toUpperCase()} {g.vmid}
                          </span>
                          <span
                            className={`shrink-0 text-[10px] ${g.status === "running" ? "text-green-400" : "text-muted-foreground"}`}
                          >
                            {g.status}
                          </span>
                          {g.ip && (
                            <span className="text-muted-foreground text-[10px] shrink-0 font-mono">
                              {g.ip}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t("common.cancel")}
          </Button>
          {guests !== null && selected.size > 0 && (
            <Button size="sm" disabled={importing} onClick={handleImport}>
              {importing ? (
                <RefreshCw className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Download className="size-3.5 mr-1.5" />
              )}
              {t("hosts.proxmoxImportButton", { count: selected.size })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
