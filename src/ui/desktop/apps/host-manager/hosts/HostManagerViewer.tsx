import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import {
  getSSHHosts,
  deleteSSHHost,
  bulkImportSSHHosts,
  bulkUpdateSSHHosts,
  updateSSHHost,
  renameFolder,
  exportSSHHostWithCredentials,
  exportAllSSHHosts,
  getSSHFolders,
  updateFolderMetadata,
  deleteAllHostsInFolder,
  refreshServerPolling,
  isElectron,
  getConfiguredServerUrl,
  getGuacamoleDpi,
  getGuacamoleTokenFromHost,
  logActivity,
} from "@/ui/main-axios.ts";
import { useServerStatus } from "@/ui/contexts/ServerStatusContext";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import {
  Edit,
  Trash2,
  Server,
  Folder,
  Tag,
  Pin,
  Terminal,
  Network,
  FileEdit,
  Search,
  Upload,
  X,
  Check,
  Pencil,
  FolderMinus,
  Copy,
  Palette,
  Trash,
  Cloud,
  Database,
  Box,
  Package,
  Layers,
  Archive,
  HardDrive,
  Globe,
  FolderOpen,
  Share2,
  ArrowDownUp,
  Container,
  Link,
  Plus,
  ListChecks,
  ChevronDown,
  Monitor,
  MessagesSquare,
  Eye,
  ChevronsDownUp,
  ChevronsUpDown,
  RefreshCw,
} from "lucide-react";
import type {
  SSHHost,
  SSHFolder,
  SSHManagerHostViewerProps,
} from "../../../../../types";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets.ts";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { FolderEditDialog } from "@/ui/desktop/apps/host-manager/dialogs/FolderEditDialog.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

const INITIAL_HOSTS_PER_FOLDER = 12;

export function HostManagerViewer({
  onEditHost,
  onAddHost,
}: SSHManagerHostViewerProps) {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const { addTab } = useTabs();
  const [hosts, setHosts] = useState<SSHHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const overwriteRef = useRef(false);
  const [draggedHost, setDraggedHost] = useState<SSHHost | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [operationLoading, setOperationLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [folderMetadata, setFolderMetadata] = useState<Map<string, SSHFolder>>(
    new Map(),
  );
  const [editingFolderAppearance, setEditingFolderAppearance] = useState<
    string | null
  >(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [openAccordions, setOpenAccordions] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<number>>(
    new Set(),
  );
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const { getStatus, refreshStatuses } = useServerStatus();
  const dragCounter = useRef(0);

  useEffect(() => {
    fetchHosts();
    fetchFolderMetadata();

    const handleHostsRefresh = () => {
      fetchHosts();
      fetchFolderMetadata();
    };

    const handleFoldersRefresh = () => {
      fetchFolderMetadata();
    };

    window.addEventListener("hosts:refresh", handleHostsRefresh);
    window.addEventListener("ssh-hosts:changed", handleHostsRefresh);
    window.addEventListener("folders:changed", handleFoldersRefresh);

    return () => {
      window.removeEventListener("hosts:refresh", handleHostsRefresh);
      window.removeEventListener("ssh-hosts:changed", handleHostsRefresh);
      window.removeEventListener("folders:changed", handleFoldersRefresh);
    };
  }, []);

  const fetchHosts = async (options: { showLoading?: boolean } = {}) => {
    const { showLoading = true } = options;
    try {
      if (showLoading) setLoading(true);
      const data = await getSSHHosts();

      const cleanedHosts = data.map((host) => {
        const cleanedHost = { ...host };
        if (cleanedHost.credentialId && cleanedHost.key) {
          cleanedHost.key = undefined;
          cleanedHost.keyPassword = undefined;
          cleanedHost.keyType = undefined;
          cleanedHost.authType = "credential";
        } else if (cleanedHost.credentialId && cleanedHost.password) {
          cleanedHost.password = undefined;
          cleanedHost.authType = "credential";
        } else if (cleanedHost.key && cleanedHost.password) {
          cleanedHost.password = undefined;
          cleanedHost.authType = "key";
        }
        return cleanedHost;
      });

      setHosts(cleanedHosts);
      setError(null);
    } catch {
      setError(t("hosts.failedToLoadHosts"));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const fetchFolderMetadata = async () => {
    try {
      const folders = await getSSHFolders();
      const metadataMap = new Map<string, SSHFolder>();
      folders.forEach((folder) => {
        metadataMap.set(folder.name, folder);
      });
      setFolderMetadata(metadataMap);
    } catch (error) {
      console.error("Failed to fetch folder metadata:", error);
    }
  };

  const handleRefreshHosts = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        fetchHosts({ showLoading: false }),
        fetchFolderMetadata(),
        refreshServerPolling(),
        refreshStatuses(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveFolderAppearance = async (
    folderName: string,
    color: string,
    icon: string,
  ) => {
    try {
      await updateFolderMetadata(folderName, color, icon);
      toast.success(t("hosts.folderAppearanceUpdated"));
      await fetchFolderMetadata();
      window.dispatchEvent(new CustomEvent("folders:changed"));
    } catch (error) {
      console.error("Failed to update folder appearance:", error);
      toast.error(t("hosts.failedToUpdateFolderAppearance"));
    }
  };

  const handleDeleteAllHostsInFolder = async (folderName: string) => {
    const hostsInFolder = hostsByFolder[folderName] || [];
    confirmWithToast(
      t("hosts.confirmDeleteAllHostsInFolder", {
        folder: folderName,
        count: hostsInFolder.length,
      }),
      async () => {
        try {
          const result = await deleteAllHostsInFolder(folderName);
          toast.success(
            t("hosts.allHostsInFolderDeleted", {
              folder: folderName,
              count: result.deletedCount,
            }),
          );
          await fetchHosts();
          await fetchFolderMetadata();
          window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
        } catch (error) {
          console.error("Failed to delete hosts in folder:", error);
          toast.error(t("hosts.failedToDeleteHostsInFolder"));
        }
      },
      "destructive",
    );
  };

  const getFolderIcon = (folderName: string) => {
    const metadata = folderMetadata.get(folderName);
    if (!metadata?.icon) return Folder;

    const iconMap: Record<string, React.ComponentType> = {
      Folder,
      Server,
      Cloud,
      Database,
      Box,
      Package,
      Layers,
      Archive,
      HardDrive,
      Globe,
    };

    return iconMap[metadata.icon] || Folder;
  };

  const getFolderColor = (folderName: string) => {
    const metadata = folderMetadata.get(folderName);
    return metadata?.color;
  };

  const handleDelete = async (hostId: number, hostName: string) => {
    confirmWithToast(
      t("hosts.confirmDelete", { name: hostName }),
      async () => {
        try {
          await deleteSSHHost(hostId);
          toast.success(t("hosts.hostDeletedSuccessfully", { name: hostName }));
          await fetchHosts();
          window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));

          refreshServerPolling();
        } catch {
          toast.error(t("hosts.failedToDeleteHost"));
        }
      },
      "destructive",
    );
  };

  const handleExport = (host: SSHHost) => {
    const actualAuthType = host.credentialId
      ? "credential"
      : host.key
        ? "key"
        : "password";

    if (actualAuthType === "credential") {
      const confirmMessage = t("hosts.exportCredentialWarning", {
        name: host.name || `${host.username}@${host.ip}`,
      });

      confirmWithToast(confirmMessage, () => {
        performExport(host);
      });
      return;
    } else if (actualAuthType === "password" || actualAuthType === "key") {
      const confirmMessage = t("hosts.exportSensitiveDataWarning", {
        name: host.name || `${host.username}@${host.ip}`,
      });

      confirmWithToast(confirmMessage, () => {
        performExport(host);
      });
      return;
    }

    performExport(host);
  };

  const performExport = async (host: SSHHost) => {
    try {
      const decryptedHost = await exportSSHHostWithCredentials(host.id);

      const cleanExportData = Object.fromEntries(
        Object.entries(decryptedHost).filter(
          ([, value]) => value !== undefined,
        ),
      );

      const exportFormat = {
        hosts: [cleanExportData],
      };

      const blob = new Blob([JSON.stringify(exportFormat, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${host.name || host.username + "@" + host.ip}-host-config.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(
        t("hosts.exportedHostConfig", {
          name: host.name || `${host.username}@${host.ip}`,
        }),
      );
    } catch {
      toast.error(t("hosts.failedToExportHost"));
    }
  };

  const handleEdit = (host: SSHHost) => {
    if (selectionMode) return;
    if (onEditHost) {
      onEditHost(host);
    }
  };

  const toggleHostSelection = (hostId: number) => {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) next.delete(hostId);
      else next.add(hostId);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedHostIds(new Set());
  };

  const handleBulkUpdate = async (updates: Record<string, unknown>) => {
    if (selectedHostIds.size === 0) return;
    try {
      setBulkUpdating(true);
      const result = await bulkUpdateSSHHosts(
        Array.from(selectedHostIds),
        updates,
      );
      if (result.updated > 0) {
        toast.success(t("hosts.bulkUpdateSuccess", { count: result.updated }));
      }
      if (result.errors.length > 0) {
        toast.error(result.errors.join(", "));
      }
      await fetchHosts();
      window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
    } catch {
      toast.error(t("hosts.bulkUpdateFailed"));
    } finally {
      setBulkUpdating(false);
    }
  };

  const selectAllHosts = () => {
    const selectableIds = hosts.filter((h) => !h.isShared).map((h) => h.id);
    setSelectedHostIds(new Set(selectableIds));
  };

  const deselectAllHosts = () => {
    setSelectedHostIds(new Set());
  };

  const handleClone = (host: SSHHost) => {
    if (onEditHost) {
      const clonedHost = { ...host };
      delete clonedHost.id;
      onEditHost(clonedHost);
    }
  };

  const copyFullScreenUrl = (host: SSHHost, appType: string) => {
    const baseUrl = isElectron()
      ? getConfiguredServerUrl() || window.location.origin
      : window.location.origin;
    const url = `${baseUrl}?view=${appType}&hostId=${host.id}`;

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        () => {
          toast.success(t("hosts.fullScreenUrlCopied"));
        },
        () => {
          fallbackCopyTextToClipboard(url);
        },
      );
    } else {
      fallbackCopyTextToClipboard(url);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      toast.success(t("hosts.fullScreenUrlCopied"));
    } catch {
      toast.error(t("hosts.failedToCopyUrl"));
    }
    document.body.removeChild(textArea);
  };

  const handleRemoveFromFolder = async (host: SSHHost) => {
    confirmWithToast(
      t("hosts.confirmRemoveFromFolder", {
        name: host.name || `${host.username}@${host.ip}`,
        folder: host.folder,
      }),
      async () => {
        try {
          setOperationLoading(true);
          const updatedHost = { ...host, folder: "" };
          await updateSSHHost(host.id, updatedHost);
          toast.success(
            t("hosts.removedFromFolder", {
              name: host.name || `${host.username}@${host.ip}`,
            }),
          );
          await fetchHosts();
          window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
        } catch {
          toast.error(t("hosts.failedToRemoveFromFolder"));
        } finally {
          setOperationLoading(false);
        }
      },
    );
  };

  const handleFolderRename = async (oldName: string) => {
    if (!editingFolderName.trim() || editingFolderName === oldName) {
      setEditingFolder(null);
      setEditingFolderName("");
      return;
    }

    try {
      setOperationLoading(true);
      await renameFolder(oldName, editingFolderName.trim());
      toast.success(
        t("hosts.folderRenamed", {
          oldName,
          newName: editingFolderName.trim(),
        }),
      );
      await fetchHosts();
      window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
      setEditingFolder(null);
      setEditingFolderName("");
    } catch {
      toast.error(t("hosts.failedToRenameFolder"));
    } finally {
      setOperationLoading(false);
    }
  };

  const startFolderEdit = (folderName: string) => {
    setEditingFolder(folderName);
    setEditingFolderName(folderName);
  };

  const cancelFolderEdit = () => {
    setEditingFolder(null);
    setEditingFolderName("");
  };

  const handleDragStart = (e: React.DragEvent, host: SSHHost) => {
    setDraggedHost(host);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
  };

  const handleDragEnd = () => {
    setDraggedHost(null);
    setDragOverFolder(null);
    dragCounter.current = 0;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragEnter = (e: React.DragEvent, folderName: string) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOverFolder(folderName);
  };

  const handleDragLeave = () => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverFolder(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetFolder: string) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverFolder(null);

    if (!draggedHost) return;

    const newFolder =
      targetFolder === t("hosts.uncategorized") ? "" : targetFolder;

    if (draggedHost.folder === newFolder) {
      setDraggedHost(null);
      return;
    }

    try {
      setOperationLoading(true);
      const updatedHost = { ...draggedHost, folder: newFolder };
      await updateSSHHost(draggedHost.id, updatedHost);
      toast.success(
        t("hosts.movedToFolder", {
          name: draggedHost.name || `${draggedHost.username}@${draggedHost.ip}`,
          folder: targetFolder,
        }),
      );
      await fetchHosts();
      window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
    } catch {
      toast.error(t("hosts.failedToMoveToFolder"));
    } finally {
      setOperationLoading(false);
      setDraggedHost(null);
    }
  };

  const getSampleData = () => ({
    hosts: [
      {
        connectionType: "ssh",
        name: t("interface.webServerProduction"),
        ip: "192.168.1.100",
        port: 22,
        username: "admin",
        authType: "password",
        password: "your_secure_password_here",
        folder: t("interface.productionFolder"),
        tags: ["web", "production", "nginx"],
        pin: true,
        notes: "Main production web server running Nginx",
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: false,
        showTerminalInSidebar: true,
        showFileManagerInSidebar: true,
        showServerStatsInSidebar: true,
        defaultPath: "/var/www",
      },
      {
        connectionType: "ssh",
        name: t("interface.databaseServer"),
        ip: "192.168.1.101",
        port: 22,
        username: "dbadmin",
        authType: "key",
        key: "-----BEGIN OPENSSH PRIVATE KEY-----\\nYour SSH private key content here\\n-----END OPENSSH PRIVATE KEY-----",
        keyPassword: "optional_key_passphrase",
        keyType: "ssh-ed25519",
        folder: t("interface.productionFolder"),
        tags: ["database", "production", "postgresql"],
        pin: false,
        notes: "PostgreSQL production database",
        enableTerminal: true,
        enableTunnel: true,
        enableFileManager: false,
        enableDocker: false,
        showTerminalInSidebar: true,
        showTunnelInSidebar: true,
        showServerStatsInSidebar: true,
        tunnelConnections: [
          {
            sourcePort: 5432,
            endpointPort: 5432,
            endpointHost: t("interface.webServerProduction"),
            maxRetries: 3,
            retryInterval: 10,
            autoStart: true,
          },
        ],
        statsConfig: {
          enabledWidgets: ["cpu", "memory", "disk", "network", "uptime"],
          statusCheckEnabled: true,
          statusCheckInterval: 30,
          metricsEnabled: true,
          metricsInterval: 30,
        },
      },
      {
        connectionType: "ssh",
        name: t("interface.developmentServer"),
        ip: "192.168.1.102",
        port: 2222,
        username: "developer",
        authType: "credential",
        credentialId: 1,
        overrideCredentialUsername: false,
        folder: t("interface.developmentFolder"),
        tags: ["dev", "testing"],
        pin: false,
        notes: "Development environment for testing",
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: true,
        showTerminalInSidebar: true,
        showFileManagerInSidebar: true,
        showDockerInSidebar: true,
        defaultPath: "/home/developer",
        sudoPassword: "dev_sudo_password",
      },
      {
        connectionType: "rdp",
        name: "Windows Server 2022",
        ip: "192.168.1.200",
        port: 3389,
        username: "Administrator",
        password: "windows_password",
        domain: "COMPANY",
        security: "nla",
        ignoreCert: false,
        folder: "Remote Desktop",
        tags: ["rdp", "windows", "production"],
        pin: false,
        notes: "Production Windows Server with RDP access",
        guacamoleConfig: {
          "enable-drive": true,
          "drive-path": "/shared",
          "create-drive-path": true,
          "server-layout": "en-us-qwerty",
          "resize-method": "display-update",
        },
      },
      {
        connectionType: "vnc",
        name: "Ubuntu Desktop",
        ip: "192.168.1.201",
        port: 5900,
        username: "vncuser",
        password: "vnc_password",
        folder: "Remote Desktop",
        tags: ["vnc", "linux", "desktop"],
        pin: false,
        notes: "Ubuntu desktop with VNC server",
        guacamoleConfig: {
          "color-depth": 24,
          cursor: "remote",
          "read-only": false,
          "clipboard-encoding": "UTF-8",
        },
      },
      {
        connectionType: "telnet",
        name: "Network Switch",
        ip: "192.168.1.254",
        port: 23,
        username: "admin",
        password: "switch_password",
        folder: "Infrastructure",
        tags: ["telnet", "network", "switch"],
        pin: false,
        notes: "Legacy network switch with Telnet access",
        guacamoleConfig: {
          "color-scheme": "green-black",
          "font-name": "monospace",
          "font-size": 12,
          scrollback: 1024,
          backspace: 127,
        },
      },
      {
        connectionType: "ssh",
        name: "Jump Host Server",
        ip: "10.0.0.50",
        port: 22,
        username: "sysadmin",
        authType: "password",
        password: "secure_password",
        folder: "Infrastructure",
        tags: ["bastion", "jump-host"],
        notes: "Jump host for accessing internal network",
        enableTerminal: true,
        enableTunnel: true,
        enableFileManager: true,
        enableDocker: false,
        jumpHosts: [
          {
            hostId: 1,
          },
        ],
        quickActions: [
          {
            name: "System Update",
            snippetId: 5,
          },
        ],
      },
      {
        connectionType: "ssh",
        name: "Server with SOCKS5 Proxy",
        ip: "10.10.10.100",
        port: 22,
        username: "proxyuser",
        authType: "password",
        password: "secure_password",
        folder: "Proxied Hosts",
        tags: ["proxy", "socks5"],
        notes: "Accessible through SOCKS5 proxy",
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: false,
        useSocks5: true,
        socks5Host: "proxy.example.com",
        socks5Port: 1080,
        socks5Username: "proxyauth",
        socks5Password: "proxypass",
      },
      {
        connectionType: "ssh",
        name: "Customized Terminal Server",
        ip: "192.168.1.150",
        port: 22,
        username: "devops",
        authType: "password",
        password: "terminal_password",
        folder: t("interface.developmentFolder"),
        tags: ["custom", "terminal"],
        notes: "Server with custom terminal configuration",
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: false,
        defaultPath: "/opt/apps",
        terminalConfig: {
          cursorBlink: true,
          cursorStyle: "bar",
          fontSize: 16,
          fontFamily: "jetbrainsMono",
          letterSpacing: 0.5,
          lineHeight: 1.2,
          theme: "monokai",
          scrollback: 50000,
          bellStyle: "visual",
          rightClickSelectsWord: true,
          fastScrollModifier: "ctrl",
          fastScrollSensitivity: 7,
          minimumContrastRatio: 4,
          backspaceMode: "normal",
          agentForwarding: true,
          environmentVariables: [
            {
              key: "NODE_ENV",
              value: "development",
            },
          ],
          autoMosh: false,
          sudoPasswordAutoFill: true,
          sudoPassword: "sudo_password_here",
        },
      },
    ],
  });

  const handleDownloadSample = () => {
    const sampleData = getSampleData();
    const blob = new Blob([JSON.stringify(sampleData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-ssh-hosts.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [exporting, setExporting] = useState(false);

  const handleExportAll = () => {
    confirmWithToast(
      t("hosts.exportAllSensitiveWarning"),
      async () => {
        setExporting(true);
        try {
          const data = await exportAllSSHHosts();
          const blob = new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `termix-hosts-export-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          toast.success(
            t("hosts.exportedAllHosts", { count: data.hosts.length }),
          );
        } catch {
          toast.error(t("hosts.failedToExportAllHosts"));
        } finally {
          setExporting(false);
        }
      },
      "destructive",
    );
  };

  const handleJsonImport = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data.hosts) && !Array.isArray(data)) {
        throw new Error(t("hosts.jsonMustContainHosts"));
      }

      const hostsArray = Array.isArray(data.hosts) ? data.hosts : data;

      if (hostsArray.length === 0) {
        throw new Error(t("hosts.noHostsInJson"));
      }

      if (hostsArray.length > 100) {
        throw new Error(t("hosts.maxHostsAllowed"));
      }

      const result = await bulkImportSSHHosts(hostsArray, overwriteRef.current);

      if (result.success > 0 || result.updated > 0) {
        const parts: string[] = [];
        if (result.success > 0)
          parts.push(`${result.success} ${t("hosts.importCreated")}`);
        if (result.updated > 0)
          parts.push(`${result.updated} ${t("hosts.importUpdated")}`);
        if (result.failed > 0)
          parts.push(`${result.failed} ${t("hosts.importFailedCount")}`);
        toast.success(parts.join(", "));
        if (result.errors.length > 0) {
          toast.error(`Import errors: ${result.errors.join(", ")}`);
        }
        await fetchHosts();
        window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
      } else {
        toast.error(t("hosts.importFailed") + `: ${result.errors.join(", ")}`);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : t("hosts.failedToImportJson");
      toast.error(t("hosts.importError") + `: ${errorMessage}`);
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const filteredAndSortedHosts = useMemo(() => {
    let filtered = hosts;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = hosts.filter((host) => {
        const searchableText = [
          host.name || "",
          host.username,
          host.ip,
          host.folder || "",
          ...(host.tags || []),
          host.authType,
          host.defaultPath || "",
        ]
          .join(" ")
          .toLowerCase();
        return searchableText.includes(query);
      });
    }

    return filtered.sort((a, b) => {
      if (a.pin && !b.pin) return -1;
      if (!a.pin && b.pin) return 1;

      const aName = a.name || a.username;
      const bName = b.name || b.username;
      return aName.localeCompare(bName);
    });
  }, [hosts, searchQuery]);

  const hostsByFolder = useMemo(() => {
    const grouped: { [key: string]: SSHHost[] } = {};

    filteredAndSortedHosts.forEach((host) => {
      const folder = host.folder || t("hosts.uncategorized");
      if (!grouped[folder]) {
        grouped[folder] = [];
      }
      grouped[folder].push(host);
    });

    const sortedFolders = Object.keys(grouped).sort((a, b) => {
      if (a === t("hosts.uncategorized")) return -1;
      if (b === t("hosts.uncategorized")) return 1;
      return a.localeCompare(b);
    });

    const sortedGrouped: { [key: string]: SSHHost[] } = {};
    sortedFolders.forEach((folder) => {
      sortedGrouped[folder] = grouped[folder];
    });

    return sortedGrouped;
  }, [filteredAndSortedHosts]);

  const folderKeys = useMemo(() => Object.keys(hostsByFolder), [hostsByFolder]);
  const folderKeysString = useMemo(() => folderKeys.join(","), [folderKeys]);

  useEffect(() => {
    setOpenAccordions((prev) => {
      if (prev.length === 0 && folderKeys.length > 0) {
        return folderKeys;
      }
      const existingFolders = prev.filter((folder) =>
        folderKeys.includes(folder),
      );
      const newFolders = folderKeys.filter((folder) => !prev.includes(folder));
      return [...existingFolders, ...newFolders];
    });
  }, [folderKeysString]);

  const toggleFolderExpansion = useCallback((folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  }, []);

  const getVisibleHosts = useCallback(
    (folderName: string, allHosts: SSHHost[]) => {
      if (
        expandedFolders.has(folderName) ||
        allHosts.length <= INITIAL_HOSTS_PER_FOLDER
      ) {
        return allHosts;
      }
      return allHosts.slice(0, INITIAL_HOSTS_PER_FOLDER);
    },
    [expandedFolders],
  );

  if (loading) {
    return <SimpleLoader visible={true} message={t("hosts.loadingHosts")} />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={fetchHosts} variant="outline">
            {t("hosts.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (hosts.length === 0) {
    return (
      <TooltipProvider>
        <div className="flex flex-col h-full min-h-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-xl font-semibold">{t("hosts.sshHosts")}</h2>
              <p className="text-muted-foreground">
                {t("hosts.hostsCount", { count: 0 })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={importing}>
                    {importing ? t("hosts.importing") : t("hosts.importJson")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      overwriteRef.current = false;
                      document.getElementById("json-import-input")?.click();
                    }}
                  >
                    {t("hosts.importSkipExisting")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      overwriteRef.current = true;
                      document.getElementById("json-import-input")?.click();
                    }}
                  >
                    {t("hosts.importOverwriteExisting")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadSample}
              >
                {t("hosts.downloadSample")}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open("https://docs.termix.site/json-import", "_blank");
                }}
              >
                {t("hosts.formatGuide")}
              </Button>

              <div className="w-px h-6 bg-border mx-2" />

              <Button
                onClick={handleRefreshHosts}
                variant="outline"
                size="sm"
                disabled={refreshing}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
                />
                {t("hosts.refresh")}
              </Button>
            </div>
          </div>

          <input
            id="json-import-input"
            type="file"
            accept=".json"
            onChange={handleJsonImport}
            className="hidden"
          />

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("placeholders.searchHosts")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
                disabled
              />
            </div>
            <Button variant="outline" className="h-9" onClick={onAddHost}>
              <Plus className="h-4 w-4 mr-2" />
              {t("hosts.addHost")}
            </Button>
          </div>

          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {t("hosts.noHosts")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("hosts.noHostsMessage")}
              </p>
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-semibold">{t("hosts.sshHosts")}</h2>
            <p className="text-muted-foreground">
              {t("hosts.hostsCount", { count: filteredAndSortedHosts.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={importing}>
                  {importing ? t("hosts.importing") : t("hosts.importJson")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    overwriteRef.current = false;
                    document.getElementById("json-import-input")?.click();
                  }}
                >
                  {t("hosts.importSkipExisting")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    overwriteRef.current = true;
                    document.getElementById("json-import-input")?.click();
                  }}
                >
                  {t("hosts.importOverwriteExisting")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              disabled={exporting || hosts.length === 0}
              onClick={handleExportAll}
            >
              {exporting ? t("hosts.exporting") : t("hosts.exportAllJson")}
            </Button>

            <Button variant="outline" size="sm" onClick={handleDownloadSample}>
              {t("hosts.downloadSample")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.open("https://docs.termix.site/json-import", "_blank");
              }}
            >
              {t("hosts.formatGuide")}
            </Button>

            <div className="w-px h-6 bg-border mx-2" />

            <Button
              onClick={handleRefreshHosts}
              variant="outline"
              size="sm"
              disabled={refreshing}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
              />
              {t("hosts.refresh")}
            </Button>
          </div>
        </div>

        <input
          id="json-import-input"
          type="file"
          accept=".json"
          onChange={handleJsonImport}
          className="hidden"
        />

        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("placeholders.searchHosts")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>
          <Button variant="outline" className="h-9" onClick={onAddHost}>
            <Plus className="h-4 w-4 mr-2" />
            {t("hosts.addHost")}
          </Button>
          <Button
            variant={selectionMode ? "default" : "outline"}
            className="h-9"
            onClick={() => {
              if (selectionMode) exitSelectionMode();
              else setSelectionMode(true);
            }}
          >
            <ListChecks className="h-4 w-4 mr-2" />
            {selectionMode ? t("hosts.exitSelectMode") : t("hosts.selectMode")}
          </Button>
          <Button
            variant="outline"
            className="h-9"
            onClick={() => {
              if (openAccordions.length > 0) {
                setOpenAccordions([]);
              } else {
                setOpenAccordions(folderKeys);
              }
            }}
            title={
              openAccordions.length > 0
                ? t("hosts.collapseAll", "Collapse All")
                : t("hosts.expandAll", "Expand All")
            }
          >
            {openAccordions.length > 0 ? (
              <ChevronsDownUp className="h-4 w-4" />
            ) : (
              <ChevronsUpDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-2 pb-20">
            {Object.entries(hostsByFolder).map(([folder, folderHosts]) => (
              <div
                key={folder}
                className={`border rounded-md transition-all duration-200 ${
                  dragOverFolder === folder
                    ? "border-blue-500 bg-blue-500/10"
                    : ""
                }`}
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, folder)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, folder)}
              >
                <Accordion
                  type="multiple"
                  value={openAccordions}
                  onValueChange={setOpenAccordions}
                >
                  <AccordionItem value={folder} className="border-none">
                    <AccordionTrigger className="px-2 py-1 bg-muted/20 border-b hover:no-underline rounded-t-md">
                      <div className="flex items-center gap-2 flex-1">
                        {(() => {
                          const FolderIcon = getFolderIcon(folder);
                          const folderColor = getFolderColor(folder);
                          return (
                            <FolderIcon
                              className="h-4 w-4"
                              style={
                                folderColor ? { color: folderColor } : undefined
                              }
                            />
                          );
                        })()}
                        {editingFolder === folder ? (
                          <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Input
                              value={editingFolderName}
                              onChange={(e) =>
                                setEditingFolderName(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter")
                                  handleFolderRename(folder);
                                if (e.key === "Escape") cancelFolderEdit();
                              }}
                              className="h-6 text-sm px-2 flex-1"
                              autoFocus
                              disabled={operationLoading}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFolderRename(folder);
                              }}
                              className="h-6 w-6 p-0"
                              disabled={operationLoading}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelFolderEdit();
                              }}
                              className="h-6 w-6 p-0"
                              disabled={operationLoading}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="font-medium cursor-pointer hover:text-blue-400 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (folder !== t("hosts.uncategorized")) {
                                  startFolderEdit(folder);
                                }
                              }}
                              title={
                                folder !== t("hosts.uncategorized")
                                  ? t("hosts.clickToRenameFolder")
                                  : ""
                              }
                            >
                              {folder}
                            </span>
                            {folder !== t("hosts.uncategorized") && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startFolderEdit(folder);
                                }}
                                className="h-4 w-4 p-0 opacity-50 hover:opacity-100 transition-opacity"
                                title={t("hosts.renameFolder")}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {folderHosts.length}
                        </Badge>
                        {selectionMode &&
                          (() => {
                            const selectableIds = folderHosts
                              .filter((h) => !h.isShared)
                              .map((h) => h.id);
                            const allSelected =
                              selectableIds.length > 0 &&
                              selectableIds.every((id) =>
                                selectedHostIds.has(id),
                              );
                            return (
                              <Checkbox
                                checked={allSelected}
                                onCheckedChange={(checked) => {
                                  setSelectedHostIds((prev) => {
                                    const next = new Set(prev);
                                    if (checked) {
                                      selectableIds.forEach((id) =>
                                        next.add(id),
                                      );
                                    } else {
                                      selectableIds.forEach((id) =>
                                        next.delete(id),
                                      );
                                    }
                                    return next;
                                  });
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="ml-1"
                              />
                            );
                          })()}
                        {folder !== t("hosts.uncategorized") && (
                          <div className="flex items-center gap-1 ml-auto">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingFolderAppearance(folder);
                                  }}
                                  className="h-6 w-6 p-0 opacity-50 hover:opacity-100 transition-opacity"
                                >
                                  <Palette className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("hosts.editFolderAppearance")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteAllHostsInFolder(folder);
                                  }}
                                  className="h-6 w-6 p-0 opacity-50 hover:opacity-100 hover:text-red-400 transition-all"
                                >
                                  <Trash className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("hosts.deleteAllHostsInFolder")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {getVisibleHosts(folder, folderHosts).map((host) => (
                          <Tooltip key={host.id}>
                            <TooltipTrigger asChild>
                              <div
                                draggable={!selectionMode}
                                onDragStart={(e) => handleDragStart(e, host)}
                                onDragEnd={handleDragEnd}
                                className={`bg-field border rounded-lg cursor-pointer hover:shadow-lg hover:bg-hover-alt transition-all duration-200 p-3 group relative ${
                                  draggedHost?.id === host.id
                                    ? "opacity-50 scale-95"
                                    : ""
                                } ${
                                  selectionMode && selectedHostIds.has(host.id)
                                    ? "ring-2 ring-blue-500 border-blue-500"
                                    : "border-input hover:border-blue-400/50"
                                } ${
                                  selectionMode && host.isShared
                                    ? "opacity-50 pointer-events-none"
                                    : ""
                                }`}
                                onClick={() => {
                                  if (selectionMode && !host.isShared) {
                                    toggleHostSelection(host.id);
                                  } else {
                                    handleEdit(host);
                                  }
                                }}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1">
                                      {selectionMode && !host.isShared && (
                                        <Checkbox
                                          checked={selectedHostIds.has(host.id)}
                                          onCheckedChange={() =>
                                            toggleHostSelection(host.id)
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="bg-background border-2 mr-1 flex-shrink-0"
                                        />
                                      )}
                                      {(() => {
                                        const statsConfig = (() => {
                                          if (!host.statsConfig) {
                                            return DEFAULT_STATS_CONFIG;
                                          }
                                          if (
                                            typeof host.statsConfig === "object"
                                          ) {
                                            return host.statsConfig;
                                          }
                                          try {
                                            return JSON.parse(host.statsConfig);
                                          } catch {
                                            return DEFAULT_STATS_CONFIG;
                                          }
                                        })();
                                        const shouldShowStatus = ![
                                          false,
                                          "false",
                                        ].includes(
                                          statsConfig.statusCheckEnabled,
                                        );

                                        if (!shouldShowStatus) return null;

                                        const serverStatus = getStatus(host.id);
                                        return (
                                          <Status
                                            status={serverStatus}
                                            className="!bg-transparent !p-0.75 flex-shrink-0"
                                          >
                                            <StatusIndicator />
                                          </Status>
                                        );
                                      })()}
                                      {host.pin && (
                                        <Pin className="h-3 w-3 text-yellow-500 flex-shrink-0" />
                                      )}
                                      <h3 className="font-medium truncate text-sm">
                                        {host.name ||
                                          (host.username
                                            ? `${host.username}@${host.ip}`
                                            : host.ip)}
                                      </h3>
                                      {host.isShared && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs px-1 py-0 text-violet-500 border-violet-500/50"
                                        >
                                          {t("rbac.shared")}
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {host.ip}:{host.port}
                                    </p>
                                    {host.username && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        {host.username}
                                      </p>
                                    )}
                                    <p className="text-xs text-muted-foreground truncate">
                                      ID: {host.id}
                                    </p>
                                  </div>
                                  <div className="flex gap-1 flex-shrink-0 ml-1">
                                    {!host.isShared &&
                                      host.folder &&
                                      host.folder !== "" && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveFromFolder(host);
                                              }}
                                              className="h-5 w-5 p-0 text-orange-500 hover:text-orange-700 hover:bg-orange-500/10"
                                              disabled={operationLoading}
                                            >
                                              <FolderMinus className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>
                                              {t("hosts.removeFromFolder", {
                                                folder: host.folder,
                                              })}
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleEdit(host);
                                          }}
                                          className="h-5 w-5 p-0 hover:bg-blue-500/10"
                                        >
                                          <Edit className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{t("hosts.editHostTooltip")}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                    {!host.isShared && (
                                      <>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(
                                                  host.id,
                                                  host.name ||
                                                    `${host.username}@${host.ip}`,
                                                );
                                              }}
                                              className="h-5 w-5 p-0 text-red-500 hover:text-red-700 hover:bg-red-500/10"
                                            >
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>
                                              {t("hosts.deleteHostTooltip")}
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleExport(host);
                                              }}
                                              className="h-5 w-5 p-0 text-blue-500 hover:text-blue-700 hover:bg-blue-500/10"
                                            >
                                              <Upload className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>
                                              {t("hosts.exportHostTooltip")}
                                            </p>
                                          </TooltipContent>
                                        </Tooltip>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleClone(host);
                                              }}
                                              className="h-5 w-5 p-0 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-500/10"
                                            >
                                              <Copy className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{t("hosts.cloneHostTooltip")}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                        <DropdownMenu>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <DropdownMenuTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                  }}
                                                  className="h-5 w-5 p-0 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-500/10"
                                                >
                                                  <Link className="h-3 w-3" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>
                                                {t("hosts.copyFullScreenUrl")}
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                          <DropdownMenuContent align="end">
                                            {(() => {
                                              const connType =
                                                host.connectionType;
                                              const isRemoteDesktop =
                                                connType === "rdp" ||
                                                connType === "vnc" ||
                                                connType === "telnet";

                                              if (isRemoteDesktop) {
                                                return (
                                                  <DropdownMenuItem
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      copyFullScreenUrl(
                                                        host,
                                                        connType,
                                                      );
                                                    }}
                                                  >
                                                    {connType === "rdp" ? (
                                                      <Monitor className="h-4 w-4 mr-2" />
                                                    ) : connType === "vnc" ? (
                                                      <Eye className="h-4 w-4 mr-2" />
                                                    ) : (
                                                      <MessagesSquare className="h-4 w-4 mr-2" />
                                                    )}
                                                    {t(
                                                      "hosts.copyRemoteDesktopUrl",
                                                    )}
                                                  </DropdownMenuItem>
                                                );
                                              }

                                              return (
                                                <>
                                                  {host.enableTerminal && (
                                                    <DropdownMenuItem
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyFullScreenUrl(
                                                          host,
                                                          "terminal",
                                                        );
                                                      }}
                                                    >
                                                      <Terminal className="h-4 w-4 mr-2" />
                                                      {t(
                                                        "hosts.copyTerminalUrl",
                                                      )}
                                                    </DropdownMenuItem>
                                                  )}
                                                  {host.enableFileManager && (
                                                    <DropdownMenuItem
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyFullScreenUrl(
                                                          host,
                                                          "file-manager",
                                                        );
                                                      }}
                                                    >
                                                      <FolderOpen className="h-4 w-4 mr-2" />
                                                      {t(
                                                        "hosts.copyFileManagerUrl",
                                                      )}
                                                    </DropdownMenuItem>
                                                  )}
                                                  {host.enableTunnel && (
                                                    <DropdownMenuItem
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyFullScreenUrl(
                                                          host,
                                                          "tunnel",
                                                        );
                                                      }}
                                                    >
                                                      <ArrowDownUp className="h-4 w-4 mr-2" />
                                                      {t("hosts.copyTunnelUrl")}
                                                    </DropdownMenuItem>
                                                  )}
                                                  <DropdownMenuItem
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      copyFullScreenUrl(
                                                        host,
                                                        "server-stats",
                                                      );
                                                    }}
                                                  >
                                                    <Server className="h-4 w-4 mr-2" />
                                                    {t(
                                                      "hosts.copyServerStatsUrl",
                                                    )}
                                                  </DropdownMenuItem>
                                                  {host.enableDocker && (
                                                    <DropdownMenuItem
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyFullScreenUrl(
                                                          host,
                                                          "docker",
                                                        );
                                                      }}
                                                    >
                                                      <Container className="h-4 w-4 mr-2" />
                                                      {t("hosts.copyDockerUrl")}
                                                    </DropdownMenuItem>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="mt-2 space-y-1">
                                  {host.tags && host.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {host.tags
                                        .slice(0, 6)
                                        .map((tag, index) => (
                                          <Badge
                                            key={index}
                                            variant="outline"
                                            className="text-xs px-1 py-0"
                                          >
                                            <Tag className="h-2 w-2 mr-0.5" />
                                            {tag}
                                          </Badge>
                                        ))}
                                      {host.tags.length > 6 && (
                                        <Badge
                                          variant="outline"
                                          className="text-xs px-1 py-0"
                                        >
                                          +{host.tags.length - 6}
                                        </Badge>
                                      )}
                                    </div>
                                  )}

                                  <div className="flex flex-wrap gap-1">
                                    {(() => {
                                      const connType = host.connectionType;
                                      if (connType === "rdp") {
                                        return (
                                          <Badge
                                            variant="outline"
                                            className="text-xs px-1 py-0"
                                          >
                                            <Monitor className="h-2 w-2 mr-0.5" />
                                            {t("hosts.rdp")}
                                          </Badge>
                                        );
                                      }
                                      if (connType === "vnc") {
                                        return (
                                          <Badge
                                            variant="outline"
                                            className="text-xs px-1 py-0"
                                          >
                                            <Eye className="h-2 w-2 mr-0.5" />
                                            {t("hosts.vnc")}
                                          </Badge>
                                        );
                                      }
                                      if (connType === "telnet") {
                                        return (
                                          <Badge
                                            variant="outline"
                                            className="text-xs px-1 py-0"
                                          >
                                            <MessagesSquare className="h-2 w-2 mr-0.5" />
                                            {t("hosts.telnet")}
                                          </Badge>
                                        );
                                      }
                                      return (
                                        <>
                                          {host.enableTerminal && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs px-1 py-0"
                                            >
                                              <Terminal className="h-2 w-2 mr-0.5" />
                                              {t("hosts.terminalBadge")}
                                            </Badge>
                                          )}
                                          {host.enableTunnel && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs px-1 py-0"
                                            >
                                              <Network className="h-2 w-2 mr-0.5" />
                                              {t("hosts.tunnelBadge")}
                                              {host.tunnelConnections &&
                                                host.tunnelConnections.length >
                                                  0 && (
                                                  <span className="ml-0.5">
                                                    (
                                                    {
                                                      host.tunnelConnections
                                                        .length
                                                    }
                                                    )
                                                  </span>
                                                )}
                                            </Badge>
                                          )}
                                          {host.enableFileManager && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs px-1 py-0"
                                            >
                                              <FileEdit className="h-2 w-2 mr-0.5" />
                                              {t("hosts.fileManagerBadge")}
                                            </Badge>
                                          )}
                                          {host.enableDocker && (
                                            <Badge
                                              variant="outline"
                                              className="text-xs px-1 py-0"
                                            >
                                              <Container className="h-2 w-2 mr-0.5" />
                                              {t("hosts.docker")}
                                            </Badge>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                </div>

                                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-center gap-1">
                                  {(() => {
                                    const connType = host.connectionType;
                                    const isRemoteDesktop =
                                      connType === "rdp" ||
                                      connType === "vnc" ||
                                      connType === "telnet";

                                    if (isRemoteDesktop) {
                                      return (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                const title = host.name?.trim()
                                                  ? host.name
                                                  : `${host.ip}:${host.port}`;

                                                try {
                                                  const protocol = connType as
                                                    | "rdp"
                                                    | "vnc"
                                                    | "telnet";
                                                  const result =
                                                    await getGuacamoleTokenFromHost(
                                                      host.id,
                                                    );

                                                  addTab({
                                                    type: protocol,
                                                    title,
                                                    hostConfig: host,
                                                    connectionConfig: {
                                                      token: result.token,
                                                      protocol,
                                                      type: protocol,
                                                      hostname: host.ip,
                                                      port: host.port,
                                                      username: host.username,
                                                      password: host.password,
                                                      domain: host.domain,
                                                      security: host.security,
                                                      "ignore-cert":
                                                        host.ignoreCert,
                                                      dpi: getGuacamoleDpi(
                                                        host,
                                                      ),
                                                    },
                                                  });

                                                  try {
                                                    await logActivity(
                                                      protocol,
                                                      host.id,
                                                      title,
                                                    );
                                                  } catch (err) {
                                                    console.warn(
                                                      `Failed to log ${protocol} activity:`,
                                                      err,
                                                    );
                                                  }
                                                } catch (error) {
                                                  toast.error(
                                                    `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`,
                                                  );
                                                }
                                              }}
                                              className="h-7 px-2 hover:bg-indigo-500/10 hover:border-indigo-500/50 flex-1"
                                            >
                                              {connType === "rdp" ? (
                                                <Monitor className="h-3.5 w-3.5" />
                                              ) : connType === "vnc" ? (
                                                <Eye className="h-3.5 w-3.5" />
                                              ) : (
                                                <MessagesSquare className="h-3.5 w-3.5" />
                                              )}
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{t("hosts.remoteDesktop")}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      );
                                    }

                                    return (
                                      <>
                                        {host.enableTerminal && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const title =
                                                    host.name?.trim()
                                                      ? host.name
                                                      : `${host.username}@${host.ip}:${host.port}`;
                                                  addTab({
                                                    type: "terminal",
                                                    title,
                                                    hostConfig: host,
                                                  });
                                                }}
                                                className="h-7 px-2 hover:bg-blue-500/10 hover:border-blue-500/50 flex-1"
                                              >
                                                <Terminal className="h-3.5 w-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{t("hosts.openTerminal")}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                        {host.enableFileManager && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const title =
                                                    host.name?.trim()
                                                      ? host.name
                                                      : `${host.username}@${host.ip}:${host.port}`;
                                                  addTab({
                                                    type: "file_manager",
                                                    title,
                                                    hostConfig: host,
                                                  });
                                                }}
                                                className="h-7 px-2 hover:bg-emerald-500/10 hover:border-emerald-500/50 flex-1"
                                              >
                                                <FolderOpen className="h-3.5 w-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>
                                                {t("hosts.openFileManager")}
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                        {host.enableTunnel && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const title =
                                                    host.name?.trim()
                                                      ? host.name
                                                      : `${host.username}@${host.ip}:${host.port}`;
                                                  addTab({
                                                    type: "tunnel",
                                                    title,
                                                    hostConfig: host,
                                                  });
                                                }}
                                                className="h-7 px-2 hover:bg-orange-500/10 hover:border-orange-500/50 flex-1"
                                              >
                                                <ArrowDownUp className="h-3.5 w-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{t("hosts.openTunnels")}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                        {host.enableDocker && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  const title =
                                                    host.name?.trim()
                                                      ? host.name
                                                      : `${host.username}@${host.ip}:${host.port}`;
                                                  addTab({
                                                    type: "docker",
                                                    title,
                                                    hostConfig: host,
                                                  });
                                                }}
                                                className="h-7 px-2 hover:bg-cyan-500/10 hover:border-cyan-500/50 flex-1"
                                              >
                                                <Container className="h-3.5 w-3.5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>{t("hosts.openDocker")}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        )}
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const title = host.name?.trim()
                                                  ? host.name
                                                  : `${host.username}@${host.ip}:${host.port}`;
                                                addTab({
                                                  type: "server_stats",
                                                  title,
                                                  hostConfig: host,
                                                });
                                              }}
                                              className="h-7 px-2 hover:bg-purple-500/10 hover:border-purple-500/50 flex-1"
                                            >
                                              <Server className="h-3.5 w-3.5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{t("hosts.openServerStats")}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-center">
                                <p className="font-medium">
                                  {t("hosts.clickToEditHost")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t("hosts.dragToMoveBetweenFolders")}
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                      {folderHosts.length > INITIAL_HOSTS_PER_FOLDER && (
                        <div className="flex justify-center mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleFolderExpansion(folder)}
                            className="text-xs"
                          >
                            {expandedFolders.has(folder)
                              ? t("common.showLess")
                              : t("common.showMore", {
                                  count:
                                    folderHosts.length -
                                    INITIAL_HOSTS_PER_FOLDER,
                                })}
                          </Button>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            ))}
          </div>
        </ScrollArea>

        {editingFolderAppearance && (
          <FolderEditDialog
            folderName={editingFolderAppearance}
            currentColor={getFolderColor(editingFolderAppearance)}
            currentIcon={folderMetadata.get(editingFolderAppearance)?.icon}
            open={editingFolderAppearance !== null}
            onOpenChange={(open) => {
              if (!open) setEditingFolderAppearance(null);
            }}
            onSave={async (color, icon) => {
              await handleSaveFolderAppearance(
                editingFolderAppearance,
                color,
                icon,
              );
              setEditingFolderAppearance(null);
            }}
          />
        )}

        {selectionMode && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-popover border border-border rounded-lg shadow-xl px-4 py-3 flex items-center gap-2 max-w-[90vw]">
            <span className="text-sm font-medium whitespace-nowrap">
              {t("hosts.selectedCount", { count: selectedHostIds.size })}
            </span>
            <div className="w-px h-6 bg-border" />

            <Button
              variant="outline"
              size="sm"
              onClick={
                selectedHostIds.size === hosts.filter((h) => !h.isShared).length
                  ? deselectAllHosts
                  : selectAllHosts
              }
            >
              {selectedHostIds.size === hosts.filter((h) => !h.isShared).length
                ? t("hosts.deselectAll")
                : t("hosts.selectAll")}
            </Button>

            <div className="w-px h-6 bg-border" />

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkUpdating || selectedHostIds.size === 0}
                >
                  <Share2 className="h-3.5 w-3.5 mr-1.5" />
                  {t("hosts.bulkMonitoring")}
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      statsConfig: { statusCheckEnabled: true },
                    });
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-2 text-green-500" />
                  {t("hosts.enableStatusCheck")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      statsConfig: { statusCheckEnabled: false },
                    });
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-2 text-red-500" />
                  {t("hosts.disableStatusCheck")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      statsConfig: { useGlobalStatusInterval: true },
                    });
                  }}
                >
                  <Globe className="h-3.5 w-3.5 mr-2 text-blue-500" />
                  {t("hosts.useGlobalStatusDefault")}
                </DropdownMenuItem>
                <div className="h-px bg-border my-1" />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ statsConfig: { metricsEnabled: true } });
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-2 text-green-500" />
                  {t("hosts.enableMetrics")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      statsConfig: { metricsEnabled: false },
                    });
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-2 text-red-500" />
                  {t("hosts.disableMetrics")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      statsConfig: { useGlobalMetricsInterval: true },
                    });
                  }}
                >
                  <Globe className="h-3.5 w-3.5 mr-2 text-blue-500" />
                  {t("hosts.useGlobalMetricsDefault")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkUpdating || selectedHostIds.size === 0}
                >
                  <Layers className="h-3.5 w-3.5 mr-1.5" />
                  {t("hosts.bulkFeatures")}
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      enableTerminal: true,
                      enableFileManager: true,
                      enableTunnel: true,
                      enableDocker: true,
                    });
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-2 text-green-500" />
                  {t("hosts.enableAllFeatures")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({
                      enableTerminal: false,
                      enableFileManager: false,
                      enableTunnel: false,
                      enableDocker: false,
                    });
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-2 text-red-500" />
                  {t("hosts.disableAllFeatures")}
                </DropdownMenuItem>
                <div className="h-px bg-border my-1" />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableTerminal: true });
                  }}
                >
                  <Terminal className="h-3.5 w-3.5 mr-2" />
                  {t("hosts.bulkEnableTerminal")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableTerminal: false });
                  }}
                >
                  <Terminal className="h-3.5 w-3.5 mr-2 opacity-30" />
                  {t("hosts.bulkDisableTerminal")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableFileManager: true });
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-2" />
                  {t("hosts.bulkEnableFileManager")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableFileManager: false });
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-2 opacity-30" />
                  {t("hosts.bulkDisableFileManager")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableTunnel: true });
                  }}
                >
                  <Network className="h-3.5 w-3.5 mr-2" />
                  {t("hosts.bulkEnableTunnel")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableTunnel: false });
                  }}
                >
                  <Network className="h-3.5 w-3.5 mr-2 opacity-30" />
                  {t("hosts.bulkDisableTunnel")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableDocker: true });
                  }}
                >
                  <Container className="h-3.5 w-3.5 mr-2" />
                  {t("hosts.bulkEnableDocker")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ enableDocker: false });
                  }}
                >
                  <Container className="h-3.5 w-3.5 mr-2 opacity-30" />
                  {t("hosts.bulkDisableDocker")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkUpdating || selectedHostIds.size === 0}
                >
                  <Folder className="h-3.5 w-3.5 mr-1.5" />
                  {t("hosts.bulkMoveFolder")}
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="center"
                className="max-h-[300px] overflow-y-auto"
              >
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ folder: "" });
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-2" />
                  {t("hosts.uncategorized")}
                </DropdownMenuItem>
                {Object.keys(hostsByFolder)
                  .filter((f) => f !== t("hosts.uncategorized"))
                  .map((f) => {
                    const FolderIcon = getFolderIcon(f);
                    const folderColor = getFolderColor(f);
                    return (
                      <DropdownMenuItem
                        key={f}
                        onSelect={(e) => {
                          e.preventDefault();
                          handleBulkUpdate({ folder: f });
                        }}
                      >
                        <FolderIcon
                          className="h-3.5 w-3.5 mr-2"
                          style={
                            folderColor ? { color: folderColor } : undefined
                          }
                        />
                        {f}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={bulkUpdating || selectedHostIds.size === 0}
                >
                  <Pin className="h-3.5 w-3.5 mr-1.5" />
                  {t("hosts.pin")}
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ pin: true });
                  }}
                >
                  <Pin className="h-3.5 w-3.5 mr-2 text-yellow-500" />
                  {t("hosts.bulkPin")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    handleBulkUpdate({ pin: false });
                  }}
                >
                  <Pin className="h-3.5 w-3.5 mr-2 opacity-30" />
                  {t("hosts.bulkUnpin")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="w-px h-6 bg-border" />
            <Button variant="ghost" size="sm" onClick={exitSelectionMode}>
              <X className="h-4 w-4 mr-1" />
              {t("hosts.exitSelectMode")}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
