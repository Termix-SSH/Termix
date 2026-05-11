import React, {
  useState,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Separator } from "@/components/separator";
import { Input } from "@/components/input";
import {
  Activity,
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Filter,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  Info,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Lock,
  MoreHorizontal,
  Monitor,
  Network,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Share2,
  Shield,
  Tag,
  Terminal,
  Trash2,
  Upload,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { toast } from "sonner";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { getSSHHosts, getCredentials } from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";

function sshHostToHost(h: SSHHostWithStatus): Host {
  return {
    id: String(h.id),
    name: h.name,
    user: h.username,
    address: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableSsh: h.connectionType === "ssh" || !h.connectionType,
    enableRdp: h.connectionType === "rdp",
    enableVnc: h.connectionType === "vnc",
    enableTelnet: h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
  };
}
import type { Host, Credential } from "@/types/ui-types";

const HOST_TABS = [
  { id: "general", label: "General", icon: <Settings className="size-3.5" /> },
  { id: "ssh", label: "SSH", icon: <Terminal className="size-3.5" /> },
  { id: "tunnels", label: "Tunnels", icon: <Network className="size-3.5" /> },
  { id: "docker", label: "Docker", icon: <Box className="size-3.5" /> },
  { id: "files", label: "Files", icon: <FolderSearch className="size-3.5" /> },
  {
    id: "stats",
    label: "Stats & Actions",
    icon: <Activity className="size-3.5" />,
  },
  { id: "rdp", label: "RDP", icon: <Monitor className="size-3.5" /> },
  { id: "vnc", label: "VNC", icon: <Monitor className="size-3.5" /> },
  { id: "telnet", label: "Telnet", icon: <Terminal className="size-3.5" /> },
  { id: "sharing", label: "Sharing", icon: <Share2 className="size-3.5" /> },
];

const CREDENTIAL_TABS = [
  { id: "general", label: "General", icon: <Info className="size-3.5" /> },
  { id: "auth", label: "Authentication", icon: <Lock className="size-3.5" /> },
];

const SSH_DEP_TABS = new Set(["tunnels", "docker", "files", "stats"]);

function TabStrip({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: { id: string; label: string; icon: React.ReactNode }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  const hasSshGroup = tabs.some((t) => SSH_DEP_TABS.has(t.id));

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Split tabs into groups for rendering a labeled SSH section
  const nonSshTabs = tabs.filter((t) => !SSH_DEP_TABS.has(t.id));
  const sshDepTabs = tabs.filter((t) => SSH_DEP_TABS.has(t.id));

  const renderTab = (tab: (typeof tabs)[0]) => (
    <button
      key={tab.id}
      onClick={() => onTabChange(tab.id)}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors shrink-0 ${
        activeTab === tab.id
          ? "border-accent-brand text-accent-brand"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {tab.icon}
      {tab.label}
    </button>
  );

  return (
    <div ref={ref} className="overflow-x-auto">
      <div className="flex min-w-max">
        {nonSshTabs.map(renderTab)}
        {hasSshGroup && sshDepTabs.length > 0 && (
          <div className="flex flex-col border-l border-border/40 ml-0.5">
            <div className="flex items-center gap-1 px-2 pt-0.5">
              <Terminal className="size-2.5 text-muted-foreground/30" />
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/30">
                SSH
              </span>
            </div>
            <div className="flex">{sshDepTabs.map(renderTab)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function HostRow({
  host,
  selectionMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
  depth = 0,
  stripeIndex = 0,
}: {
  host: Host;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  depth?: number;
  stripeIndex?: number;
}) {
  const [hovered, setHovered] = useState(false);

  const connTypeColor = "border-border/60 text-muted-foreground/60";

  const hasSsh = host.enableSsh;

  const sshActions: { type: string; icon: typeof Terminal; label: string }[] = [
    { type: "terminal", icon: Terminal, label: "Terminal" },
    { type: "files", icon: FolderSearch, label: "Files" },
    { type: "docker", icon: Box, label: "Docker" },
    { type: "tunnel", icon: Network, label: "Tunnels" },
    { type: "stats", icon: Server, label: "Stats" },
  ];

  const fireOpen = (type: string) => {
    window.dispatchEvent(
      new CustomEvent("termix:open-tab", { detail: { hostId: host.id, type } }),
    );
  };

  return (
    <div
      draggable={!!onDragStart && !selectionMode}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={selectionMode ? onToggleSelect : undefined}
      style={{ paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : undefined }}
      className={`relative flex flex-col border-b border-border/50 last:border-0 transition-colors select-none
        ${selectionMode ? "cursor-pointer" : ""}
        ${selected ? "bg-accent-brand/5" : hovered ? "bg-muted/40" : stripeIndex % 2 === 1 ? "bg-muted/20" : ""}
        ${onDragStart && !selectionMode ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        {selectionMode && (
          <div
            className={`size-3.5 border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
          >
            {selected && <Check className="size-2 text-background" />}
          </div>
        )}

        {/* Status dot */}
        <div
          className={`size-1.5 rounded-full shrink-0 ${host.online ? "bg-accent-brand shadow-[0_0_4px_rgba(251,146,60,0.5)]" : "bg-muted-foreground/25"}`}
        />

        {/* Name + badges */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-[13px] font-semibold truncate leading-none">
            {host.name}
          </span>
          {host.pin && (
            <Pin className="size-2.5 text-accent-brand/50 shrink-0" />
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            {host.enableSsh && (
              <span
                className={`text-[9px] px-1 py-0.5 font-bold border leading-none ${connTypeColor}`}
              >
                SSH
              </span>
            )}
            {host.enableRdp && (
              <span
                className={`text-[9px] px-1 py-0.5 font-bold border leading-none ${connTypeColor}`}
              >
                RDP
              </span>
            )}
            {host.enableVnc && (
              <span
                className={`text-[9px] px-1 py-0.5 font-bold border leading-none ${connTypeColor}`}
              >
                VNC
              </span>
            )}
            {host.enableTelnet && (
              <span
                className={`text-[9px] px-1 py-0.5 font-bold border leading-none ${connTypeColor}`}
              >
                TELNET
              </span>
            )}
          </div>
        </div>

        {/* Right: last access always visible, CPU/RAM on hover */}
        <div className="flex items-center gap-2 shrink-0">
          {host.online && hovered && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/50">CPU</span>
                <div className="w-10 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${host.cpu! > 80 ? "bg-red-400" : host.cpu! > 50 ? "bg-yellow-400" : "bg-accent-brand"}`}
                    style={{ width: `${host.cpu}%` }}
                  />
                </div>
                <span className="text-[9px] tabular-nums text-accent-brand font-bold">
                  {host.cpu}%
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/50">RAM</span>
                <div className="w-10 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${host.ram! > 80 ? "bg-red-400" : host.ram! > 60 ? "bg-yellow-400" : "bg-accent-brand/60"}`}
                    style={{ width: `${host.ram}%` }}
                  />
                </div>
                <span className="text-[9px] tabular-nums text-accent-brand font-bold">
                  {host.ram}%
                </span>
              </div>
            </div>
          )}
          <span className="text-[10px] text-muted-foreground/40 tabular-nums shrink-0">
            {host.lastAccess}
          </span>
        </div>
      </div>

      {/* Sub-row: address + tags */}
      <div
        className="flex items-center gap-2 px-3 pb-1.5 -mt-0.5"
        style={{
          paddingLeft:
            depth > 0 ? `${depth * 12 + 8 + 12 + 8 + 6}px` : undefined,
        }}
      >
        <span className="text-[11px] text-muted-foreground/50 font-mono truncate shrink-0 max-w-[160px]">
          {host.username}@{host.ip}
        </span>
        {host.tags && host.tags.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {host.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1 py-px border border-border/50 bg-muted/30 text-muted-foreground/60 lowercase shrink-0 leading-none"
              >
                {tag}
              </span>
            ))}
            {host.tags.length > 4 && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                +{host.tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Hover action tray */}
      {hovered && !selectionMode && (
        <div
          className="border-t border-border/40"
          style={{ marginLeft: depth > 0 ? `-${depth * 12 + 8}px` : undefined }}
        >
          <div
            className="flex items-center pt-0.5 pb-1"
            style={{
              paddingLeft: depth > 0 ? `${depth * 12 + 8}px` : "8px",
              paddingRight: "8px",
            }}
          >
            {hasSsh &&
              sshActions.map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    fireOpen(type);
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                >
                  <Icon className="size-3 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            {hasSsh &&
              (host.enableRdp || host.enableVnc || host.enableTelnet) && (
                <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
              )}
            {host.enableRdp && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fireOpen("rdp");
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <Monitor className="size-3 shrink-0" />
                <span>RDP</span>
              </button>
            )}
            {host.enableVnc && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fireOpen("vnc");
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <Monitor className="size-3 shrink-0" />
                <span>VNC</span>
              </button>
            )}
            {host.enableTelnet && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  fireOpen("telnet");
                }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                <Terminal className="size-3 shrink-0" />
                <span>Telnet</span>
              </button>
            )}
            <div className="flex-1" />
            <button
              title="Edit Host"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
            >
              <Pencil className="size-3 shrink-0" />
              <span>Edit</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center size-6 text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors"
                >
                  <MoreHorizontal className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs">
                <DropdownMenuItem onClick={() => toast.success("Host cloned")}>
                  <Copy className="size-3.5 mr-2" />
                  Clone Host
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${host.username}@${host.ip}`,
                    );
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="size-3.5 mr-2" />
                  Copy Address
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="size-3.5 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  );
}

function HostEditor({
  host,
  activeTab,
  onBack,
  protocols,
  onProtocolChange,
  onTabChange,
}: {
  host: Host | null;
  activeTab: string;
  onBack: () => void;
  protocols: {
    enableSsh: boolean;
    enableRdp: boolean;
    enableVnc: boolean;
    enableTelnet: boolean;
  };
  onProtocolChange: (p: Partial<typeof protocols>) => void;
  onTabChange: (tab: string) => void;
}) {
  const [authMethod, setAuthMethod] = useState(host?.authType || "password");

  const handleProtocolToggle = (
    proto: keyof typeof protocols,
    value: boolean,
  ) => {
    onProtocolChange({ [proto]: value });
    const tabForProto: Record<string, string> = {
      enableSsh: "ssh",
      enableRdp: "rdp",
      enableVnc: "vnc",
      enableTelnet: "telnet",
    };
    if (!value && activeTab === tabForProto[proto]) onTabChange("general");
    if (value && tabForProto[proto]) onTabChange(tabForProto[proto]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        {activeTab === "general" && (
          <>
            {/* Protocols — enable/disable each connection type */}
            <SectionCard
              title="Protocols"
              icon={<Globe className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 py-3">
                {[
                  {
                    proto: "enableSsh" as const,
                    label: "SSH",
                    desc: "Secure Shell",
                    icon: <Terminal className="size-4" />,
                    port: protocols.enableSsh ? (host?.sshPort ?? 22) : 22,
                    defaultPort: 22,
                  },
                  {
                    proto: "enableRdp" as const,
                    label: "RDP",
                    desc: "Remote Desktop",
                    icon: <Monitor className="size-4" />,
                    port: protocols.enableRdp ? (host?.rdpPort ?? 3389) : 3389,
                    defaultPort: 3389,
                  },
                  {
                    proto: "enableVnc" as const,
                    label: "VNC",
                    desc: "Virtual Network",
                    icon: <Monitor className="size-4" />,
                    port: protocols.enableVnc ? (host?.vncPort ?? 5900) : 5900,
                    defaultPort: 5900,
                  },
                  {
                    proto: "enableTelnet" as const,
                    label: "Telnet",
                    desc: "Unencrypted shell",
                    icon: <Terminal className="size-4" />,
                    port: protocols.enableTelnet
                      ? (host?.telnetPort ?? 23)
                      : 23,
                    defaultPort: 23,
                  },
                ].map(({ proto, label, desc, icon, port, defaultPort }) => {
                  const enabled = protocols[proto];
                  return (
                    <div
                      key={proto}
                      className={`flex items-center gap-3 p-3 border transition-colors ${enabled ? "border-accent-brand/20 bg-accent-brand/5" : "border-border bg-muted/10"}`}
                    >
                      <div
                        className={`size-8 flex items-center justify-center shrink-0 ${enabled ? "text-accent-brand" : "text-muted-foreground/30"}`}
                      >
                        {icon}
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <span
                          className={`text-xs font-bold ${enabled ? "text-foreground" : "text-muted-foreground/50"}`}
                        >
                          {label}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {desc}
                        </span>
                        {enabled && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground/60">
                              Port
                            </span>
                            <Input
                              type="number"
                              defaultValue={port}
                              className="h-6 w-16 text-[10px] px-2"
                            />
                          </div>
                        )}
                      </div>
                      <FakeSwitch
                        defaultChecked={enabled}
                        onChange={(v: boolean) =>
                          handleProtocolToggle(proto, v)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Connection Details"
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Address / IP
                  </label>
                  <Input
                    placeholder="10.0.0.1 or example.com"
                    defaultValue={host?.address || ""}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Friendly Name
                    </label>
                    <Input
                      placeholder="e.g. Web Server Production"
                      defaultValue={host?.name || ""}
                    />
                  </div>
                  {protocols.enableSsh && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        MAC Address
                      </label>
                      <Input
                        placeholder="AA:BB:CC:DD:EE:FF"
                        defaultValue={host?.macAddress || ""}
                      />
                    </div>
                  )}
                </div>
              </div>
            </SectionCard>

            {!protocols.enableSsh &&
              !protocols.enableRdp &&
              !protocols.enableVnc &&
              !protocols.enableTelnet && (
                <div className="flex items-center gap-3 p-3 border border-border bg-muted/20 text-xs text-muted-foreground">
                  <Globe className="size-4 shrink-0 text-muted-foreground/40" />
                  <span>
                    Enable at least one protocol above to configure
                    authentication and connection settings.
                  </span>
                </div>
              )}

            <SectionCard
              title="Proxy & Bastion"
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label="Use SOCKS5 Proxy"
                  description="Route connection through a proxy server"
                >
                  <FakeSwitch defaultChecked={host?.useSocks5} />
                </SettingRow>
                <div className="flex flex-col gap-3 p-3 bg-muted/20 border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Proxy Chain
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                    >
                      <Plus className="size-3 mr-1" /> Add Node
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 p-2 bg-background border border-border">
                      <span className="text-[10px] font-bold text-muted-foreground">
                        1.
                      </span>
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder="Host"
                        defaultValue="proxy.internal"
                      />
                      <Input
                        className="h-7 text-xs w-20"
                        placeholder="Port"
                        defaultValue="1080"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Jump Host Chain
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                    >
                      <Plus className="size-3 mr-1" /> Add Jump
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 p-2 bg-background border border-border">
                      <span className="text-[10px] font-bold text-muted-foreground">
                        1.
                      </span>
                      <select className="flex h-7 flex-1 border border-border bg-background px-2 py-0 text-xs outline-none focus:ring-1 focus:ring-ring">
                        <option>Select a server...</option>
                        {hosts.map((h) => (
                          <option key={h.id}>{h.name}</option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Folder & Advanced"
              icon={<Tag className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Folder
                  </label>
                  <Input
                    placeholder="e.g. Production"
                    defaultValue={host?.folder || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Tags
                  </label>
                  <Input
                    placeholder="space separated"
                    defaultValue={host?.tags?.join(" ") || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5 col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Private Notes
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Details about this server..."
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
                    defaultValue={host?.notes || ""}
                  />
                </div>
                <SettingRow
                  label="Pin to Top"
                  description="Always show this host at the top of the list"
                >
                  <FakeSwitch defaultChecked={host?.pin} />
                </SettingRow>
              </div>
              <div className="flex flex-col gap-3 border-t border-border pt-4 pb-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Port Knocking Sequence
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                  >
                    <Plus className="size-3 mr-1" /> Add Knock
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex items-center gap-1.5 p-1.5 bg-muted/30 border border-border">
                    <Input className="h-7 text-xs w-16" placeholder="Port" />
                    <select className="h-7 text-[10px] bg-background border border-border">
                      <option>TCP</option>
                      <option>UDP</option>
                    </select>
                    <Input className="h-7 text-xs w-14" placeholder="Delay" />
                    <button className="text-destructive p-1">
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "ssh" && (
          <>
            <SectionCard
              title="Authentication"
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Auth Method
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["password", "key", "credential", "none", "opkssh"].map(
                      (m) => (
                        <button
                          key={m}
                          onClick={() => setAuthMethod(m as any)}
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${authMethod === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {m}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4 mt-1">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Username
                    </label>
                    <Input placeholder="root" defaultValue={host?.user || ""} />
                  </div>
                  {authMethod === "password" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Password
                      </label>
                      <Input
                        type="password"
                        placeholder="••••••••"
                        defaultValue={host?.password || ""}
                      />
                    </div>
                  )}
                  {authMethod === "key" && (
                    <>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          SSH Private Key
                        </label>
                        <textarea
                          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                          rows={5}
                          defaultValue={host?.key || ""}
                          className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Key Passphrase
                        </label>
                        <Input
                          type="password"
                          placeholder="Optional"
                          defaultValue={host?.keyPassword || ""}
                        />
                      </div>
                    </>
                  )}
                  {authMethod === "credential" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Stored Credential
                      </label>
                      <select
                        defaultValue={host?.credentialId || ""}
                        className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="">Select a credential...</option>
                        {credentials.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.username})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <SettingRow
                  label="Force Keyboard Interactive"
                  description="Force manual password entry even if keys are present"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Terminal Appearance"
              icon={<Palette className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Theme Preview
                  </label>
                  <div className="w-full bg-[#111210] border border-border font-mono text-xs leading-relaxed overflow-hidden">
                    <div className="px-3 py-2.5 flex flex-col gap-0.5">
                      <div>
                        <span className="text-[#5af78e]">deploy@web-01</span>
                        <span className="text-[#555]">:</span>
                        <span className="text-[#57c7ff]">~</span>
                        <span className="text-[#555]">$</span>
                        <span className="text-[#f1f1f0]"> ls -la</span>
                      </div>
                      <div className="text-[#555]">total 48</div>
                      <div>
                        <span className="text-[#9aedfe]">drwxr-xr-x</span>
                        <span className="text-[#555]">
                          {" "}
                          5 deploy deploy 4096 May 1 09:12{" "}
                        </span>
                        <span className="text-[#57c7ff]">.</span>
                      </div>
                      <div>
                        <span className="text-[#9aedfe]">drwxr-xr-x</span>
                        <span className="text-[#555]">
                          {" "}
                          3 root root 4096 Apr 15 18:44{" "}
                        </span>
                        <span className="text-[#57c7ff]">..</span>
                      </div>
                      <div>
                        <span className="text-[#9aedfe]">-rw-r--r--</span>
                        <span className="text-[#555]">
                          {" "}
                          1 deploy deploy 220 Apr 15 18:44{" "}
                        </span>
                        <span className="text-[#f1f1f0]">.bash_logout</span>
                      </div>
                      <div>
                        <span className="text-[#9aedfe]">-rwxr-xr-x</span>
                        <span className="text-[#555]">
                          {" "}
                          1 deploy deploy 8192 May 1 08:55{" "}
                        </span>
                        <span className="text-[#5af78e]">deploy.sh</span>
                      </div>
                      <div className="flex items-center gap-0.5 mt-0.5">
                        <span className="text-[#5af78e]">deploy@web-01</span>
                        <span className="text-[#555]">:</span>
                        <span className="text-[#57c7ff]">~</span>
                        <span className="text-[#555]">$</span>
                        <span className="text-[#f1f1f0]"> </span>
                        <span className="inline-block w-1.5 h-3.5 bg-[#f1f1f0] animate-pulse" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Color Theme
                    </label>
                    <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                      <option>Termix Dark</option>
                      <option>One Dark</option>
                      <option>Monokai</option>
                      <option>Dracula</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Font Family
                    </label>
                    <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono">
                      <option>JetBrains Mono</option>
                      <option>Fira Code</option>
                      <option>Source Code Pro</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Font Size
                    </label>
                    <Input type="number" defaultValue={14} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Cursor Style
                    </label>
                    <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                      <option>Block</option>
                      <option>Underline</option>
                      <option>Bar</option>
                    </select>
                  </div>
                </div>
                <SettingRow
                  label="Cursor Blinking"
                  description="Enable blinking animation for the terminal cursor"
                >
                  <FakeSwitch defaultChecked={true} />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Letter Spacing
                    </label>
                    <Input type="number" step="0.1" defaultValue={0} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Line Height
                    </label>
                    <Input type="number" step="0.1" defaultValue={1.2} />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Behavior & Advanced"
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Scrollback Buffer
                  </label>
                  <Input type="number" defaultValue={10000} />
                  <span className="text-[10px] text-muted-foreground">
                    Maximum number of lines kept in history
                  </span>
                </div>
                <SettingRow
                  label="SSH Agent Forwarding"
                  description="Pass your local SSH keys to this host"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable Auto-Mosh"
                  description="Prefer Mosh over SSH if available"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable Auto-Tmux"
                  description="Automatically launch or attach to tmux session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Sudo Password Auto-fill"
                  description="Automatically provide sudo password when prompted"
                >
                  <FakeSwitch />
                </SettingRow>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Environment Variables
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                    >
                      <Plus className="size-3 mr-1" /> Add Variable
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder="KEY"
                        defaultValue="NODE_ENV"
                      />
                      <Input
                        className="h-7 text-xs flex-1"
                        placeholder="VALUE"
                        defaultValue="production"
                      />
                      <button className="text-destructive">
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Keepalive Interval
                    </label>
                    <Input type="number" defaultValue={30} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Max Keepalive Misses
                    </label>
                    <Input type="number" defaultValue={3} />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "tunnels" && (
          <>
            <SectionCard
              title="Tunnel Settings"
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label="Enable Tunneling"
                  description="Enable SSH tunnel functionality for this host"
                >
                  <FakeSwitch defaultChecked={host?.enableTunnel ?? true} />
                </SettingRow>
                <div className="text-xs text-muted-foreground p-3 bg-muted/30 border border-border space-y-1">
                  <p>
                    <strong>Requirements:</strong> The SSH server must have{" "}
                    <code className="bg-muted px-1">GatewayPorts yes</code>,{" "}
                    <code className="bg-muted px-1">
                      AllowTcpForwarding yes
                    </code>
                    , and{" "}
                    <code className="bg-muted px-1">PermitRootLogin yes</code>{" "}
                    set in{" "}
                    <code className="bg-muted px-1">/etc/ssh/sshd_config</code>.
                  </p>
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title="Server Tunnels"
              icon={<Network className="size-3.5" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                >
                  <Plus className="size-3 mr-1" /> Add Tunnel
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-3">
                {[
                  {
                    mode: "remote",
                    endpointHost: "prod-db",
                    endpointPort: 5432,
                    currentHostIp: "0.0.0.0",
                    src: 5432,
                    maxRetries: 3,
                    retryInterval: 10,
                    autoStart: true,
                  },
                  {
                    mode: "local",
                    endpointHost: "web-server",
                    endpointPort: 80,
                    currentHostIp: "127.0.0.1",
                    src: 8080,
                    maxRetries: 3,
                    retryInterval: 10,
                    autoStart: false,
                  },
                  {
                    mode: "dynamic",
                    endpointHost: "",
                    endpointPort: 0,
                    currentHostIp: "127.0.0.1",
                    src: 1080,
                    maxRetries: 3,
                    retryInterval: 10,
                    autoStart: true,
                  },
                ].map((tun, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-3 p-3 border border-border bg-muted/20 relative group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-muted-foreground">
                        Server Tunnel {i + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <div
                            className={`size-1.5 rounded-full ${tun.autoStart ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                          />
                          <span
                            className={`text-[10px] font-bold uppercase tracking-widest ${tun.autoStart ? "text-accent-brand" : "text-muted-foreground"}`}
                          >
                            {tun.autoStart ? "Connected" : "Idle"}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                        >
                          Connect
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive"
                          onClick={() => toast.success("Tunnel removed")}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-muted-foreground">
                        Tunnel Type
                      </label>
                      <div className="flex gap-2">
                        {["remote", "local", "dynamic"].map((m) => (
                          <button
                            key={m}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${tun.mode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {tun.mode === "remote"
                          ? "Remote (R→L): Opens a port on the remote server and forwards traffic to a local service."
                          : tun.mode === "local"
                            ? "Local (L→R): Opens a port locally and forwards traffic through the SSH server to a remote service."
                            : "Dynamic (SOCKS): Creates a local SOCKS proxy that routes traffic through the SSH server."}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {tun.mode !== "dynamic" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            Endpoint SSH Config
                          </label>
                          <select
                            defaultValue={tun.endpointHost || ""}
                            className="h-7 text-xs bg-background border border-border px-2 outline-none focus:ring-1 focus:ring-ring"
                          >
                            <option value="">Select a host...</option>
                            {hosts.map((h) => (
                              <option key={h.id} value={h.name}>
                                {h.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {tun.mode !== "dynamic" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {tun.mode === "remote"
                              ? "Remote Port"
                              : "Endpoint Port"}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            defaultValue={tun.endpointPort}
                          />
                        </div>
                      )}
                      {tun.mode !== "dynamic" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            Current Host IP
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="0.0.0.0 or 127.0.0.1"
                            defaultValue={tun.currentHostIp}
                          />
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          {tun.mode === "remote" ? "Local Port" : "Source Port"}
                        </label>
                        <Input className="h-7 text-xs" defaultValue={tun.src} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          Max Retries
                        </label>
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          defaultValue={tun.maxRetries}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          Retry Interval (s)
                        </label>
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          defaultValue={tun.retryInterval}
                        />
                      </div>
                    </div>
                    <SettingRow
                      label="Auto-start"
                      description="Automatically connect this tunnel when the host is loaded"
                    >
                      <FakeSwitch defaultChecked={tun.autoStart} />
                    </SettingRow>
                  </div>
                ))}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "docker" && (
          <SectionCard
            title="Docker Integration"
            icon={<Box className="size-3.5" />}
          >
            <div className="flex flex-col gap-4 py-3">
              <SettingRow
                label="Enable Docker"
                description="Monitor and manage containers on this host via Docker"
              >
                <FakeSwitch defaultChecked={host?.enableDocker} />
              </SettingRow>
            </div>
          </SectionCard>
        )}

        {activeTab === "files" && (
          <SectionCard
            title="File Manager"
            icon={<FolderSearch className="size-3.5" />}
          >
            <div className="flex flex-col gap-4 py-3">
              <SettingRow
                label="Enable File Manager"
                description="Browse and manage files on this host over SFTP"
              >
                <FakeSwitch defaultChecked={host?.enableFileManager ?? true} />
              </SettingRow>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Default Path
                </label>
                <Input
                  placeholder="~"
                  defaultValue={host?.defaultPath || "~"}
                />
                <span className="text-[10px] text-muted-foreground">
                  The directory to open when the file manager launches for this
                  host.
                </span>
              </div>
            </div>
          </SectionCard>
        )}

        {activeTab === "stats" && (
          <>
            <SectionCard
              title="Status Checks"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label="Enable Status Checks"
                  description="Periodically ping this host to verify availability"
                >
                  <FakeSwitch
                    defaultChecked={
                      host?.statsConfig?.statusCheckEnabled ?? true
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Use Global Interval"
                  description="Override with the server-wide status check interval"
                >
                  <FakeSwitch
                    defaultChecked={
                      host?.statsConfig?.useGlobalStatusInterval ?? true
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Check Interval (s)"
                  description="Seconds between each connectivity ping"
                >
                  <Input
                    type="number"
                    defaultValue={host?.statsConfig?.statusCheckInterval ?? 60}
                    className="w-20 h-7 text-xs text-right"
                  />
                </SettingRow>
              </div>
            </SectionCard>
            <SectionCard
              title="Metrics Collection"
              icon={<Server className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label="Enable Metrics"
                  description="Collect CPU, RAM, disk, and network usage from this host"
                >
                  <FakeSwitch
                    defaultChecked={host?.statsConfig?.metricsEnabled ?? true}
                  />
                </SettingRow>
                <SettingRow
                  label="Use Global Interval"
                  description="Override with the server-wide metrics interval"
                >
                  <FakeSwitch
                    defaultChecked={
                      host?.statsConfig?.useGlobalMetricsInterval ?? true
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Metrics Interval (s)"
                  description="Seconds between metric snapshots"
                >
                  <Input
                    type="number"
                    defaultValue={host?.statsConfig?.metricsInterval ?? 30}
                    className="w-20 h-7 text-xs text-right"
                  />
                </SettingRow>
              </div>
            </SectionCard>
            <SectionCard
              title="Visible Widgets"
              icon={<LayoutDashboard className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                {[
                  {
                    id: "cpu",
                    label: "CPU Usage",
                    desc: "CPU percent, load averages, sparkline graph",
                  },
                  {
                    id: "memory",
                    label: "Memory",
                    desc: "RAM usage, swap, cached",
                  },
                  {
                    id: "disk",
                    label: "Storage",
                    desc: "Disk usage per mount point",
                  },
                  {
                    id: "disk_io",
                    label: "Disk I/O",
                    desc: "Read/write MB/s per device",
                  },
                  {
                    id: "network",
                    label: "Network",
                    desc: "Interface list and bandwidth",
                  },
                  {
                    id: "processes",
                    label: "Top Processes",
                    desc: "PID, CPU%, MEM%, command",
                  },
                  {
                    id: "logins",
                    label: "Recent Logins",
                    desc: "Successful and failed login events",
                  },
                  {
                    id: "ports",
                    label: "Listening Ports",
                    desc: "Open ports with process and state",
                  },
                  {
                    id: "security",
                    label: "Security",
                    desc: "Firewall, AppArmor, SELinux status",
                  },
                ].map((w) => (
                  <SettingRow key={w.id} label={w.label} description={w.desc}>
                    <FakeSwitch
                      defaultChecked={
                        (host?.statsConfig?.enabledWidgets ?? []).includes(
                          w.id,
                        ) || !host?.statsConfig
                      }
                    />
                  </SettingRow>
                ))}
              </div>
            </SectionCard>
            <SectionCard
              title="Quick Actions"
              icon={<Zap className="size-3.5" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                >
                  <Plus className="size-3 mr-1" /> Add Action
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Quick actions appear as buttons in the Server Stats toolbar
                  for one-click command execution.
                </p>
                {[
                  { name: "Restart Nginx", snippet: "System Update" },
                  { name: "Clear Logs", snippet: "Clear Logs" },
                ].map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 bg-muted/20 border border-border group"
                  >
                    <Input
                      className="h-7 text-xs flex-1"
                      placeholder="Button label"
                      defaultValue={a.name}
                    />
                    <select className="flex h-7 flex-1 border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring">
                      <option>System Update</option>
                      <option>Clear Logs</option>
                      <option>Check SSL</option>
                      <option>Disk Usage Report</option>
                    </select>
                    <button className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                {host?.quickActions?.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40 gap-1.5">
                    <Zap className="size-6" />
                    <span className="text-xs">No quick actions yet.</span>
                  </div>
                )}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "rdp" && (
          <>
            <SectionCard
              title="Authentication"
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Username
                  </label>
                  <Input
                    placeholder="Administrator"
                    defaultValue={host?.rdpUser || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Password
                  </label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    defaultValue={host?.rdpPassword || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Domain
                  </label>
                  <Input
                    placeholder="WORKGROUP"
                    defaultValue={host?.domain || ""}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Connection Settings"
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Security Mode
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="any">Any</option>
                    <option value="nla">NLA</option>
                    <option value="nla-ext">NLA Extended</option>
                    <option value="tls">TLS</option>
                    <option value="vmconnect">VMConnect</option>
                    <option value="rdp">RDP</option>
                  </select>
                </div>
                <SettingRow
                  label="Ignore Certificate"
                  description="Allow connections to hosts with self-signed certificates"
                >
                  <FakeSwitch defaultChecked={host?.ignoreCert} />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Display Settings"
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Color Depth
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="8">8-bit</option>
                    <option value="16">16-bit</option>
                    <option value="24">24-bit</option>
                    <option value="32">32-bit</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Width
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Height
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    DPI
                  </label>
                  <Input type="number" placeholder="96" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Resize Method
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label="Force Lossless"
                  description="Force lossless image encoding (higher quality, more bandwidth)"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Audio Settings"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label="Disable Audio"
                  description="Mute all audio from the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable Audio Input (Microphone)"
                  description="Forward local microphone to the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="RDP Performance"
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label="Wallpaper"
                  description="Show desktop wallpaper (disabling improves performance)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Theming"
                  description="Enable visual themes and styles"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Font Smoothing"
                  description="Enable ClearType font rendering"
                >
                  <FakeSwitch defaultChecked={true} />
                </SettingRow>
                <SettingRow
                  label="Full Window Drag"
                  description="Show window contents while dragging"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Desktop Composition"
                  description="Enable Aero glass effects"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Menu Animations"
                  description="Enable menu fade and slide animations"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Bitmap Caching"
                  description="Turn off bitmap cache (may help with glitches)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Offscreen Caching"
                  description="Turn off offscreen cache"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Glyph Caching"
                  description="Turn off glyph cache"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable GFX"
                  description="Use RemoteFX graphics pipeline"
                >
                  <FakeSwitch defaultChecked={true} />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Device Redirection"
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label="Enable Printing"
                  description="Redirect local printers to the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable Drive Redirection"
                  description="Map a local folder as a drive in the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Drive Name
                    </label>
                    <Input placeholder="Termix Drive" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Drive Path
                    </label>
                    <Input placeholder="/home/user/shared" />
                  </div>
                </div>
                <SettingRow
                  label="Create Drive Path"
                  description="Automatically create the folder if it does not exist"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Download"
                  description="Prevent downloading files from the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Upload"
                  description="Prevent uploading files to the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Enable Touch"
                  description="Enable touch input forwarding"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard title="Session" icon={<Server className="size-3.5" />}>
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Client Name
                  </label>
                  <Input placeholder="Termix" />
                </div>
                <SettingRow
                  label="Console Session"
                  description="Connect to the console (session 0) instead of a new session"
                >
                  <FakeSwitch />
                </SettingRow>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Initial Program
                  </label>
                  <Input placeholder="e.g. cmd.exe" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Server Layout
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option>en-us-qwerty</option>
                    <option>en-gb-qwerty</option>
                    <option>de-de-qwertz</option>
                    <option>fr-fr-azerty</option>
                    <option>it-it-qwerty</option>
                    <option>sv-se-qwerty</option>
                    <option>ja-jp-qwerty</option>
                    <option>pt-br-qwerty</option>
                    <option>es-es-qwerty</option>
                    <option>failsafe</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Timezone
                  </label>
                  <Input placeholder="e.g. America/New_York" />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Gateway"
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Gateway Hostname
                    </label>
                    <Input placeholder="gateway.example.com" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Gateway Port
                    </label>
                    <Input type="number" placeholder="443" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Gateway Username
                    </label>
                    <Input placeholder="user" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Gateway Password
                    </label>
                    <Input type="password" placeholder="••••••••" />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Gateway Domain
                    </label>
                    <Input placeholder="DOMAIN" />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="RemoteApp"
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    RemoteApp Program
                  </label>
                  <Input placeholder="||MyApp" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Working Directory
                  </label>
                  <Input placeholder="C:\Apps\MyApp" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Arguments
                  </label>
                  <Input placeholder="--flag value" />
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Clipboard" icon={<Copy className="size-3.5" />}>
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Normalize Line Endings
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label="Disable Copy"
                  description="Prevent copying text from the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Paste"
                  description="Prevent pasting text into the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Session Recording"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Path
                  </label>
                  <Input placeholder="/var/lib/termix/recordings" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Name
                  </label>
                  <Input placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}" />
                </div>
                <SettingRow
                  label="Create Path if Missing"
                  description="Automatically create the recording directory"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Exclude Output"
                  description="Do not record screen output (metadata only)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Exclude Mouse"
                  description="Do not record mouse movements"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Include Keystrokes"
                  description="Record raw keystrokes in addition to screen output"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Wake-on-LAN"
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label="Send WOL Packet"
                  description="Send a magic packet to wake this host before connecting"
                >
                  <FakeSwitch />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      MAC Address
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      defaultValue={host?.macAddress || ""}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Broadcast Address
                    </label>
                    <Input placeholder="255.255.255.255" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      UDP Port
                    </label>
                    <Input type="number" placeholder="9" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Wait Time (s)
                    </label>
                    <Input type="number" placeholder="0" />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "vnc" && (
          <>
            <SectionCard
              title="Authentication"
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    VNC Password
                  </label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    defaultValue={host?.vncPassword || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Username (optional)
                  </label>
                  <Input
                    placeholder="Leave blank if not required"
                    defaultValue={host?.vncUser || ""}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Display Settings"
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Color Depth
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="8">8-bit</option>
                    <option value="16">16-bit</option>
                    <option value="24">24-bit</option>
                    <option value="32">32-bit</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Width
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Height
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Resize Method
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label="Force Lossless"
                  description="Force lossless image encoding (higher quality, more bandwidth)"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Audio Settings"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label="Disable Audio"
                  description="Mute all audio from the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="VNC Settings"
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Cursor Mode
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="local">Local</option>
                    <option value="remote">Remote</option>
                  </select>
                </div>
                <SettingRow
                  label="Swap Red/Blue"
                  description="Swap the red and blue color channels (fixes some colour issues)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Read-only"
                  description="View the remote screen without sending any input"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard title="Clipboard" icon={<Copy className="size-3.5" />}>
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Normalize Line Endings
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label="Disable Copy"
                  description="Prevent copying text from the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Disable Paste"
                  description="Prevent pasting text into the remote session"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Session Recording"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Path
                  </label>
                  <Input placeholder="/var/lib/termix/recordings" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Name
                  </label>
                  <Input placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}" />
                </div>
                <SettingRow
                  label="Create Path if Missing"
                  description="Automatically create the recording directory"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Exclude Output"
                  description="Do not record screen output (metadata only)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Exclude Mouse"
                  description="Do not record mouse movements"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Include Keystrokes"
                  description="Record raw keystrokes in addition to screen output"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title="Wake-on-LAN"
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label="Send WOL Packet"
                  description="Send a magic packet to wake this host before connecting"
                >
                  <FakeSwitch />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      MAC Address
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      defaultValue={host?.macAddress || ""}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Broadcast Address
                    </label>
                    <Input placeholder="255.255.255.255" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      UDP Port
                    </label>
                    <Input type="number" placeholder="9" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Wait Time (s)
                    </label>
                    <Input type="number" placeholder="0" />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "telnet" && (
          <>
            <SectionCard
              title="Authentication"
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Username
                  </label>
                  <Input
                    placeholder="admin"
                    defaultValue={host?.telnetUser || ""}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Password
                  </label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    defaultValue={host?.telnetPassword || ""}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Display Settings"
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Width
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Height
                    </label>
                    <Input type="number" placeholder="Auto" />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Terminal Settings"
              icon={<Terminal className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Terminal Type
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="xterm">xterm</option>
                    <option value="xterm-256color">xterm-256color</option>
                    <option value="vt100">VT100</option>
                    <option value="vt220">VT220</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Font Name
                  </label>
                  <Input placeholder="monospace" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Font Size
                  </label>
                  <Input type="number" defaultValue={12} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Color Scheme
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="black-white">Black on White</option>
                    <option value="white-black">White on Black</option>
                    <option value="gray-black">Gray on Black</option>
                    <option value="green-black">Green on Black</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Backspace Key
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="auto">Auto</option>
                    <option value="127">DEL (127)</option>
                    <option value="8">BS (8)</option>
                  </select>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Session Recording"
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Path
                  </label>
                  <Input placeholder="/var/lib/termix/recordings" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Recording Name
                  </label>
                  <Input placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}" />
                </div>
                <SettingRow
                  label="Create Path if Missing"
                  description="Automatically create the recording directory"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Exclude Output"
                  description="Do not record screen output (metadata only)"
                >
                  <FakeSwitch />
                </SettingRow>
                <SettingRow
                  label="Include Keystrokes"
                  description="Record raw keystrokes in addition to screen output"
                >
                  <FakeSwitch />
                </SettingRow>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "sharing" && (
          <>
            {host === null && (
              <div className="flex items-start gap-3 p-3 border border-yellow-500/30 bg-yellow-500/5 text-xs text-yellow-500">
                <Shield className="size-3.5 shrink-0 mt-0.5" />
                <div>
                  <strong>Save the host first.</strong> Sharing options are
                  available after the host has been saved.
                </div>
              </div>
            )}

            <SectionCard
              title="Share Host"
              icon={<Users className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex gap-2">
                  {["user", "role"].map((t) => (
                    <button
                      key={t}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${t === "user" ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {t === "user" ? (
                        <>
                          <User className="size-3 inline mr-1" />
                          Share with User
                        </>
                      ) : (
                        <>
                          <Shield className="size-3 inline mr-1" />
                          Share with Role
                        </>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Select User
                  </label>
                  <select className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring">
                    <option value="">Select a user...</option>
                    <option>alice</option>
                    <option>bob</option>
                    <option>charlie</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Permission Level
                  </label>
                  <div className="px-3 py-2 border border-border bg-muted/30 text-xs text-muted-foreground">
                    View only
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Expires in (hours)
                  </label>
                  <Input
                    type="number"
                    placeholder="Leave empty for no expiry"
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand"
                    onClick={() => toast.success("Host shared successfully")}
                  >
                    <Plus className="size-3.5 mr-1.5" />
                    Share
                  </Button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Current Access"
              icon={<ListChecks className="size-3.5" />}
            >
              <div className="py-2">
                <div className="grid grid-cols-6 gap-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
                  <span>Type</span>
                  <span>Target</span>
                  <span>Permission</span>
                  <span>Granted By</span>
                  <span>Expires</span>
                  <span></span>
                </div>
                {[
                  {
                    type: "User",
                    target: "alice",
                    permission: "View",
                    grantedBy: "admin",
                    expires: "Never",
                    expired: false,
                  },
                  {
                    type: "Role",
                    target: "Developers",
                    permission: "View",
                    grantedBy: "admin",
                    expires: "2026-06-01",
                    expired: false,
                  },
                  {
                    type: "User",
                    target: "bob",
                    permission: "View",
                    grantedBy: "alice",
                    expires: "2026-04-01",
                    expired: true,
                  },
                ].map((r, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-6 gap-2 px-2 py-2.5 border-b border-border last:border-0 items-center text-xs"
                  >
                    <div className="flex items-center gap-1">
                      {r.type === "User" ? (
                        <User className="size-3 text-muted-foreground" />
                      ) : (
                        <Shield className="size-3 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">{r.type}</span>
                    </div>
                    <span className="font-semibold">{r.target}</span>
                    <span>{r.permission}</span>
                    <span className="text-muted-foreground">{r.grantedBy}</span>
                    <span
                      className={
                        r.expired ? "text-destructive" : "text-muted-foreground"
                      }
                    >
                      {r.expired ? (
                        <span className="flex items-center gap-1">
                          <X className="size-3" />
                          Expired
                        </span>
                      ) : (
                        r.expires
                      )}
                    </span>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                        onClick={() => toast.success("Access revoked")}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-3 mb-6">
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={() => {
            toast.success("Host configuration saved");
            onBack();
          }}
        >
          Save Host
        </Button>
      </div>
    </div>
  );
}

function CredentialEditorView({
  credential,
  activeTab,
  onBack,
}: {
  credential: Credential | null;
  activeTab: string;
  onBack: () => void;
}) {
  const [type, setType] = useState(credential?.type || "password");

  return (
    <div className="flex flex-col gap-3">
      {activeTab === "general" && (
        <SectionCard
          title="Basic Information"
          icon={<Info className="size-3.5" />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Friendly Name
              </label>
              <Input
                placeholder="e.g. Production SSH Key"
                defaultValue={credential?.name || ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Folder
              </label>
              <Input
                placeholder="e.g. Server Keys"
                defaultValue={credential?.folder || ""}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Description
              </label>
              <Input
                placeholder="Optional details..."
                defaultValue={credential?.description || ""}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Tags
              </label>
              <Input
                placeholder="space separated"
                defaultValue={credential?.tags?.join(" ") || ""}
              />
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === "auth" && (
        <SectionCard
          title="Authentication Details"
          icon={<Lock className="size-3.5" />}
        >
          <div className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Type
              </label>
              <div className="flex gap-2">
                {["password", "key"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setType(m as any)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${type === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {m === "key" ? "SSH Private Key" : "Password"}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Username
              </label>
              <Input
                placeholder="e.g. root or deploy"
                defaultValue={credential?.username || ""}
              />
            </div>
            {type === "password" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Password
                </label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  defaultValue={credential?.value || ""}
                />
              </div>
            )}
            {type === "key" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    SSH Private Key
                  </label>
                  <textarea
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={8}
                    defaultValue={credential?.value || ""}
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    SSH Public Key (Optional)
                  </label>
                  <textarea
                    placeholder="ssh-rsa AAAAB3Nza..."
                    rows={3}
                    defaultValue={credential?.publicKey || ""}
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Key Passphrase (Optional)
                  </label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    defaultValue={credential?.passphrase || ""}
                  />
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <div className="flex justify-end gap-3 mt-3">
        <Button variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={() => {
            toast.success("Credential saved");
            onBack();
          }}
        >
          Save Credential
        </Button>
      </div>
    </div>
  );
}

export function HostManager({
  onCollapse,
  pendingEditId,
  pendingAction,
}: {
  onCollapse?: () => void;
  pendingEditId?: MutableRefObject<string | null>;
  pendingAction?: MutableRefObject<"add-host" | "add-credential" | null>;
} = {}) {
  const [section, setSection] = useState<"hosts" | "credentials">("hosts");
  const [editingHost, setEditingHost] = useState<Host | "new" | null>(null);
  const [editingCredential, setEditingCredential] = useState<
    Credential | "new" | null
  >(null);
  const [activeHostTab, setActiveHostTab] = useState("general");
  const [activeCredentialTab, setActiveCredentialTab] = useState("general");
  const [searchQuery, setSearchQuery] = useState("");
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(
    new Set(),
  );
  const [editingFolderName, setEditingFolderName] = useState<string | null>(
    null,
  );
  const [editingFolderValue, setEditingFolderValue] = useState("");
  const [draggedHost, setDraggedHost] = useState<Host | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [editingProtocols, setEditingProtocols] = useState({
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importOverwriteRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    getSSHHosts()
      .then((raw) => {
        const converted = raw.map(sshHostToHost);
        setHosts(converted);
        setExpandedFolders(
          new Set(converted.map((h) => h.folder.split(" / ")[0])),
        );
      })
      .catch(() => {});
    getCredentials()
      .then((res: any) => {
        const arr = Array.isArray(res?.credentials) ? res.credentials : [];
        setCredentials(
          arr.map((c: any) => ({
            id: String(c.id),
            name: c.name,
            username: c.username,
            type: c.authType === "key" ? "key" : "password",
            description: c.description ?? "",
            folder: c.folder ?? "",
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (pendingEditId?.current) {
      const id = pendingEditId.current;
      pendingEditId.current = null;
      const host = hosts.find((h) => h.id === id);
      if (host) {
        setSection("hosts");
        setEditingHost(host);
        setEditingCredential(null);
        setActiveHostTab("general");
        setEditingProtocols({
          enableSsh: host.enableSsh,
          enableRdp: host.enableRdp,
          enableVnc: host.enableVnc,
          enableTelnet: host.enableTelnet,
        });
      }
    }
    if (pendingAction?.current) {
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action === "add-host") {
        setSection("hosts");
        setEditingHost("new");
        setEditingCredential(null);
        setEditingProtocols({
          enableSsh: true,
          enableRdp: false,
          enableVnc: false,
          enableTelnet: false,
        });
        setActiveHostTab("general");
      } else if (action === "add-credential") {
        setSection("credentials");
        setEditingCredential("new");
        setEditingHost(null);
      }
    }
  }, [pendingEditId, pendingAction]);

  useEffect(() => {
    const handleAddHost = () => {
      setSection("hosts");
      setEditingHost("new");
      setEditingCredential(null);
      setEditingProtocols({
        enableSsh: true,
        enableRdp: false,
        enableVnc: false,
        enableTelnet: false,
      });
      setActiveHostTab("general");
    };
    const handleAddCredential = () => {
      setSection("credentials");
      setEditingCredential("new");
      setEditingHost(null);
    };
    const handleEditHost = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const host = hosts.find((h) => h.id === id);
      if (host) {
        setSection("hosts");
        setEditingHost(host);
        setEditingCredential(null);
        setActiveHostTab("general");
        setEditingProtocols({
          enableSsh: host.enableSsh,
          enableRdp: host.enableRdp,
          enableVnc: host.enableVnc,
          enableTelnet: host.enableTelnet,
        });
      }
    };
    window.addEventListener("host-manager:add-host", handleAddHost);
    window.addEventListener("host-manager:add-credential", handleAddCredential);
    window.addEventListener("host-manager:edit-host", handleEditHost);
    return () => {
      window.removeEventListener("host-manager:add-host", handleAddHost);
      window.removeEventListener(
        "host-manager:add-credential",
        handleAddCredential,
      );
      window.removeEventListener("host-manager:edit-host", handleEditHost);
    };
  }, []);

  const allHosts = hosts;
  const filteredHosts = allHosts.filter(
    (h) =>
      h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())),
  );
  const filteredCredentials = credentials.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const folders = Array.from(new Set(allHosts.map((h) => h.folder))).sort();
  const pinnedHosts = filteredHosts.filter((h) => h.pin);
  const hostsByFolder = folders.reduce<Record<string, Host[]>>(
    (acc, folder) => {
      acc[folder] = filteredHosts.filter((h) => h.folder === folder && !h.pin);
      return acc;
    },
    {},
  );
  const credentialFolders = Array.from(
    new Set(credentials.map((c) => c.folder || "Uncategorized")),
  ).sort();

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };
  const toggleHostSelection = (id: string) => {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const handleExportHosts = () => {
    const data = JSON.stringify({ hosts: allHosts }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "termix-hosts.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Hosts exported successfully");
  };

  const handleDownloadSample = () => {
    const sample = JSON.stringify(
      {
        hosts: [
          {
            name: "My Server",
            address: "192.168.1.1",
            user: "root",
            port: 22,
            folder: "Production",
            enableSsh: true,
            enableRdp: false,
            enableVnc: false,
            enableTelnet: false,
            sshPort: 22,
            rdpPort: 3389,
            vncPort: 5900,
            telnetPort: 23,
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
    toast.success("Sample file downloaded");
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      toast.success("Host statuses refreshed");
    }, 1200);
  };

  // Build a nested folder tree from flat hosts using "/" as path separator
  type FolderNode = {
    name: string;
    fullPath: string;
    children: FolderNode[];
    hosts: Host[];
  };

  const buildFolderTree = (hostList: Host[]): FolderNode => {
    const root: FolderNode = {
      name: "",
      fullPath: "",
      children: [],
      hosts: [],
    };
    const nodeMap = new Map<string, FolderNode>();
    nodeMap.set("", root);

    const ensureNode = (path: string): FolderNode => {
      if (nodeMap.has(path)) return nodeMap.get(path)!;
      const parts = path.split(" / ");
      const parentPath = parts.slice(0, -1).join(" / ");
      const parent = ensureNode(parentPath);
      const node: FolderNode = {
        name: parts[parts.length - 1],
        fullPath: path,
        children: [],
        hosts: [],
      };
      parent.children.push(node);
      nodeMap.set(path, node);
      return node;
    };

    for (const host of hostList) {
      const node = ensureNode(host.folder || "");
      if (!host.pin) node.hosts.push(host);
    }
    return root;
  };

  const folderTree = buildFolderTree(filteredHosts);

  // Global stripe counter — mutable object so renderFolderNode can increment across recursion
  const stripeCounter = { value: 0 };

  const renderFolderNode = (
    node: FolderNode,
    depth: number = 0,
  ): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.fullPath);
    const isOver = dragOverFolder === node.fullPath;
    const totalHosts = (() => {
      const count = (n: FolderNode): number =>
        n.hosts.length + n.children.reduce((s, c) => s + count(c), 0);
      return count(node);
    })();
    const onlineHosts = (() => {
      const count = (n: FolderNode): number =>
        n.hosts.filter((h) => h.online).length +
        n.children.reduce((s, c) => s + count(c), 0);
      return count(node);
    })();

    if (totalHosts === 0 && node.children.length === 0) return null;

    const folderStripe = stripeCounter.value++ % 2 === 1;

    return (
      <div key={node.fullPath}>
        <div
          className={`flex items-center gap-1.5 py-1.5 border-b border-border/40 group/folder transition-colors ${isOver ? "bg-accent-brand/5" : folderStripe ? "bg-muted/20 hover:bg-muted/40" : "hover:bg-muted/30"}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverFolder(node.fullPath);
          }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverFolder(null);
            if (draggedHost) {
              toast.success(`Moved ${draggedHost.name} to ${node.fullPath}`);
              setDraggedHost(null);
            }
          }}
        >
          <button
            className="flex items-center gap-1.5 flex-1 text-left min-w-0"
            onClick={() => toggleFolder(node.fullPath)}
          >
            <ChevronRight
              className={`size-3 text-muted-foreground/40 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
            {isExpanded ? (
              <FolderOpen className="size-3 text-accent-brand/60 shrink-0" />
            ) : (
              <Folder className="size-3 text-muted-foreground/50 shrink-0" />
            )}
            {editingFolderName === node.fullPath ? (
              <input
                autoFocus
                value={editingFolderValue}
                onChange={(e) => setEditingFolderValue(e.target.value)}
                onBlur={() => {
                  setEditingFolderName(null);
                  toast.success(`Folder renamed`);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setEditingFolderName(null);
                    toast.success(`Folder renamed`);
                  }
                  if (e.key === "Escape") setEditingFolderName(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] font-semibold bg-background border border-accent-brand/60 px-1 outline-none text-foreground min-w-0 flex-1"
              />
            ) : (
              <span className="text-[11px] font-semibold text-foreground/70 truncate">
                {node.name}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/40 shrink-0 ml-0.5 tabular-nums">
              {onlineHosts > 0 && (
                <span className="text-accent-brand">{onlineHosts}</span>
              )}
              <span>/{totalHosts}</span>
            </span>
          </button>
          <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity pr-2">
            <button
              className="size-5 flex items-center justify-center text-muted-foreground/40 hover:text-foreground rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setEditingFolderName(node.fullPath);
                setEditingFolderValue(node.name);
              }}
            >
              <Pencil className="size-2.5" />
            </button>
            <button
              className="size-5 flex items-center justify-center text-muted-foreground/40 hover:text-destructive rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                toast.success(`Deleted folder`);
              }}
            >
              <Trash2 className="size-2.5" />
            </button>
          </div>
        </div>

        {isExpanded && (
          <>
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
            {node.hosts.map((host) => {
              const stripe = stripeCounter.value++ % 2 === 1;
              return (
                <HostRow
                  key={host.id}
                  host={host}
                  depth={depth + 1}
                  stripeIndex={stripe ? 1 : 0}
                  selectionMode={selectionMode}
                  selected={selectedHostIds.has(host.id)}
                  onToggleSelect={() => toggleHostSelection(host.id)}
                  onEdit={() => {
                    setEditingHost(host);
                    setActiveHostTab("general");
                    setEditingProtocols({
                      enableSsh: host.enableSsh,
                      enableRdp: host.enableRdp,
                      enableVnc: host.enableVnc,
                      enableTelnet: host.enableTelnet,
                    });
                  }}
                  onDelete={() => toast.success(`Deleted ${host.name}`)}
                  onDragStart={() => setDraggedHost(host)}
                  onDragEnd={() => setDraggedHost(null)}
                />
              );
            })}
          </>
        )}
      </div>
    );
  };

  // Editor view: full-width with top tab bar instead of side nav
  const renderEditorView = () => {
    const isHost = !!editingHost;
    const tabs = isHost
      ? HOST_TABS.filter((t) => {
          if (t.id === "general" || t.id === "sharing") return true;
          if (["ssh", "tunnels", "docker", "files", "stats"].includes(t.id))
            return editingProtocols.enableSsh;
          if (t.id === "rdp") return editingProtocols.enableRdp;
          if (t.id === "vnc") return editingProtocols.enableVnc;
          if (t.id === "telnet") return editingProtocols.enableTelnet;
          return false;
        })
      : CREDENTIAL_TABS;
    const activeTab = isHost ? activeHostTab : activeCredentialTab;
    const setActiveTab = isHost ? setActiveHostTab : setActiveCredentialTab;

    return (
      <div className="flex flex-col flex-1 min-h-0">
        {/* Back bar + tab strip */}
        <div className="flex flex-col shrink-0 border-b border-border">
          <button
            onClick={() => {
              if (isHost) {
                setEditingHost(null);
                setActiveHostTab("general");
              } else {
                setEditingCredential(null);
                setActiveCredentialTab("general");
              }
            }}
            className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-b border-border/50"
          >
            <ArrowLeft className="size-3.5 shrink-0" />
            <span>Back to {isHost ? "Hosts" : "Credentials"}</span>
            {isHost && editingHost !== "new" && (
              <span className="ml-auto font-semibold text-foreground truncate max-w-[200px]">
                {(editingHost as Host).name}
              </span>
            )}
          </button>
          <TabStrip
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
          {isHost ? (
            <HostEditor
              key={
                editingHost === "new" ? "new-host" : (editingHost as Host).id
              }
              host={editingHost === "new" ? null : (editingHost as Host)}
              activeTab={activeHostTab}
              onBack={() => {
                setEditingHost(null);
                setActiveHostTab("general");
              }}
              protocols={editingProtocols}
              onProtocolChange={(p) =>
                setEditingProtocols((prev) => ({ ...prev, ...p }))
              }
              onTabChange={setActiveHostTab}
            />
          ) : (
            <CredentialEditorView
              key={
                editingCredential === "new"
                  ? "new-cred"
                  : (editingCredential as Credential).id
              }
              credential={
                editingCredential === "new"
                  ? null
                  : (editingCredential as Credential)
              }
              activeTab={activeCredentialTab}
              onBack={() => {
                setEditingCredential(null);
                setActiveCredentialTab("general");
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const isEditing = !!editingHost || !!editingCredential;

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Top bar: section switcher + actions */}
      {!isEditing && (
        <div className="flex items-center gap-0 shrink-0 border-b border-border/60">
          {/* Section tabs */}
          <button
            onClick={() => {
              setSection("hosts");
              setEditingCredential(null);
              setSearchQuery("");
            }}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${section === "hosts" ? "border-accent-brand text-accent-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Server className="size-3.5" />
            Hosts
            <span className="text-[10px] font-bold text-muted-foreground/50 ml-0.5">
              {allHosts.length}
            </span>
          </button>
          <button
            onClick={() => {
              setSection("credentials");
              setEditingHost(null);
              setSearchQuery("");
            }}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors ${section === "credentials" ? "border-accent-brand text-accent-brand" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <KeyRound className="size-3.5" />
            Credentials
            <span className="text-[10px] font-bold text-muted-foreground/50 ml-0.5">
              {credentials.length}
            </span>
          </button>

          <div className="flex-1" />

          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground shrink-0"
              title="Collapse"
              onClick={onCollapse}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
          )}

          {/* Action buttons — icon-only to save space */}
          {section === "hosts" && (
            <div className="flex items-center gap-0.5 pr-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0])
                    toast.success(
                      importOverwriteRef.current
                        ? "Hosts imported (overwrite)"
                        : "Hosts imported",
                    );
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title="Refresh"
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
                    className="size-8 text-muted-foreground hover:text-foreground"
                    title="Import / Export"
                  >
                    <Upload className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem
                    onClick={() => {
                      importOverwriteRef.current = false;
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5 mr-2" />
                    Import (skip existing)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      importOverwriteRef.current = true;
                      fileInputRef.current?.click();
                    }}
                  >
                    <Upload className="size-3.5 mr-2" />
                    Import (overwrite)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleExportHosts}
                    disabled={allHosts.length === 0}
                  >
                    <Download className="size-3.5 mr-2" />
                    Export All
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDownloadSample}>
                    <Download className="size-3.5 mr-2" />
                    Download Sample
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon"
                className={`size-8 transition-colors ${selectionMode ? "text-accent-brand bg-accent-brand/10" : "text-muted-foreground hover:text-foreground"}`}
                title={selectionMode ? "Exit selection" : "Select multiple"}
                onClick={() => {
                  setSelectionMode((s) => !s);
                  setSelectedHostIds(new Set());
                }}
              >
                <ListChecks className="size-3.5" />
              </Button>
              <div className="w-px h-4 bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  setEditingHost("new");
                  setActiveHostTab("general");
                  setEditingProtocols({
                    enableSsh: true,
                    enableRdp: false,
                    enableVnc: false,
                    enableTelnet: false,
                  });
                }}
              >
                <Plus className="size-3.5 mr-1" />
                Add Host
              </Button>
            </div>
          )}
          {section === "credentials" && (
            <div className="flex items-center gap-0.5 pr-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  setEditingCredential("new");
                  setActiveCredentialTab("general");
                }}
              >
                <Plus className="size-3.5 mr-1" />
                Add Credential
              </Button>
            </div>
          )}
        </div>
      )}

      {isEditing ? (
        renderEditorView()
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Search bar */}
          <div className="px-2 py-1.5 shrink-0 border-b border-border/40">
            <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60">
              <Search className="size-3 text-muted-foreground/60 shrink-0" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  section === "hosts"
                    ? "Search hosts, addresses, tags…"
                    : "Search credentials…"
                }
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50 text-foreground min-w-0"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {section === "hosts" && (
              <div className="flex flex-col">
                {/* Pinned hosts */}
                {pinnedHosts.length > 0 && (
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-accent-brand/5">
                      <Pin className="size-2.5 text-accent-brand" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-accent-brand">
                        Pinned
                      </span>
                      <span className="text-[10px] text-accent-brand/50 ml-0.5">
                        {pinnedHosts.length}
                      </span>
                    </div>
                    {pinnedHosts.map((host) => (
                      <HostRow
                        key={host.id}
                        host={host}
                        selectionMode={selectionMode}
                        selected={selectedHostIds.has(host.id)}
                        onToggleSelect={() => toggleHostSelection(host.id)}
                        onEdit={() => {
                          setEditingHost(host);
                          setActiveHostTab("general");
                          setEditingProtocols({
                            enableSsh: host.enableSsh,
                            enableRdp: host.enableRdp,
                            enableVnc: host.enableVnc,
                            enableTelnet: host.enableTelnet,
                          });
                        }}
                        onDelete={() => toast.success(`Deleted ${host.name}`)}
                      />
                    ))}
                  </div>
                )}

                {/* Nested folder tree */}
                {folderTree.children.map((node) => renderFolderNode(node, 0))}
                {/* Root-level (no folder) hosts */}
                {folderTree.hosts.map((host) => (
                  <HostRow
                    key={host.id}
                    host={host}
                    selectionMode={selectionMode}
                    selected={selectedHostIds.has(host.id)}
                    onToggleSelect={() => toggleHostSelection(host.id)}
                    onEdit={() => {
                      setEditingHost(host);
                      setActiveHostTab("general");
                      setEditingProtocols({
                        enableSsh: host.enableSsh,
                        enableRdp: host.enableRdp,
                        enableVnc: host.enableVnc,
                        enableTelnet: host.enableTelnet,
                      });
                    }}
                    onDelete={() => toast.success(`Deleted ${host.name}`)}
                    onDragStart={() => setDraggedHost(host)}
                    onDragEnd={() => setDraggedHost(null)}
                  />
                ))}

                {filteredHosts.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <Server className="size-8 text-muted-foreground/20 mb-2" />
                    <span className="text-sm font-semibold text-muted-foreground/60">
                      No hosts found
                    </span>
                    <span className="text-xs text-muted-foreground/40 mt-1">
                      {searchQuery
                        ? "Try a different term"
                        : "Add your first host to get started"}
                    </span>
                    {!searchQuery && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 h-7 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
                        onClick={() => {
                          setEditingHost("new");
                          setActiveHostTab("general");
                          setEditingProtocols({
                            enableSsh: true,
                            enableRdp: false,
                            enableVnc: false,
                            enableTelnet: false,
                          });
                        }}
                      >
                        <Plus className="size-3 mr-1" />
                        Add Host
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {section === "credentials" && (
              <div className="flex flex-col">
                {credentialFolders.map((folder) => {
                  const creds = filteredCredentials.filter(
                    (c) => (c.folder || "Uncategorized") === folder,
                  );
                  if (creds.length === 0) return null;
                  return (
                    <div key={folder}>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-muted/20">
                        <Folder className="size-3 text-muted-foreground/50" />
                        <span className="text-[10px] font-semibold text-muted-foreground/70">
                          {folder}
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">
                          {creds.length}
                        </span>
                      </div>
                      {creds.map((cred) => {
                        const usedByHosts = allHosts.filter(
                          (h) => h.credentialId === cred.id,
                        );
                        return (
                          <div
                            key={cred.id}
                            className="flex items-center justify-between px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/30 group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="size-7 border border-border/60 bg-muted/30 flex items-center justify-center shrink-0">
                                {cred.type === "key" ? (
                                  <Shield className="size-3 text-accent-brand" />
                                ) : (
                                  <Lock className="size-3 text-accent-brand" />
                                )}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold truncate">
                                    {cred.name}
                                  </span>
                                  <span
                                    className={`text-[9px] px-1 py-px font-bold border leading-none shrink-0 ${cred.type === "key" ? "border-accent-brand/30 text-accent-brand" : "border-border/60 text-muted-foreground/60"}`}
                                  >
                                    {cred.type === "key" ? "KEY" : "PWD"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-muted-foreground/50 truncate">
                                  {cred.username}
                                  {usedByHosts.length > 0 && (
                                    <span className="text-muted-foreground/30">
                                      {" "}
                                      · {usedByHosts.length}h
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {cred.type === "key" && (
                                <button
                                  className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `ssh-copy-id -i ~/.ssh/id_rsa.pub ${cred.username}@<host>`,
                                    );
                                    toast.success("Copied");
                                  }}
                                >
                                  <Copy className="size-3" />
                                </button>
                              )}
                              <button
                                className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors"
                                onClick={() => {
                                  setEditingCredential(cred);
                                  setActiveCredentialTab("general");
                                }}
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                className="size-6 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                onClick={() =>
                                  toast.success(`Deleted ${cred.name}`)
                                }
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {filteredCredentials.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                    <KeyRound className="size-8 text-muted-foreground/20 mb-2" />
                    <span className="text-sm font-semibold text-muted-foreground/60">
                      No credentials found
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 h-7 text-xs border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
                      onClick={() => {
                        setEditingCredential("new");
                        setActiveCredentialTab("general");
                      }}
                    >
                      <Plus className="size-3 mr-1" />
                      Add Credential
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating selection bar */}
      {selectionMode && !isEditing && (
        <div className="absolute bottom-4 inset-x-3 z-50">
          <div className="bg-popover border border-border shadow-xl px-2.5 py-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold tabular-nums shrink-0">
              {selectedHostIds.size} selected
            </span>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                if (selectedHostIds.size === allHosts.length)
                  setSelectedHostIds(new Set());
                else setSelectedHostIds(new Set(allHosts.map((h) => h.id)));
              }}
            >
              {selectedHostIds.size === allHosts.length
                ? "Deselect All"
                : "All"}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1"
                  disabled={selectedHostIds.size === 0}
                >
                  Features <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem onClick={() => toast.success("Done")}>
                  <Terminal className="size-3.5 mr-2" />
                  Enable Terminal
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.success("Done")}>
                  <FolderSearch className="size-3.5 mr-2" />
                  Enable Files
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.success("Done")}>
                  <Network className="size-3.5 mr-2" />
                  Enable Tunnels
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => toast.success("Done")}>
                  <Box className="size-3.5 mr-2" />
                  Enable Docker
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1"
                  disabled={selectedHostIds.size === 0}
                >
                  Move <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onClick={() => toast.success(`Moved to ${f}`)}
                  >
                    <FolderOpen className="size-3.5 mr-2" />
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className="text-[10px] text-destructive hover:text-destructive px-1.5 py-1 hover:bg-destructive/10 rounded transition-colors"
              disabled={selectedHostIds.size === 0}
              onClick={() => {
                toast.success(`Deleted ${selectedHostIds.size} hosts`);
                setSelectedHostIds(new Set());
              }}
            >
              Delete
            </button>
            <div className="flex-1" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                setSelectionMode(false);
                setSelectedHostIds(new Set());
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
