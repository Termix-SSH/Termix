import React, {
  useState,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  TERMINAL_THEMES,
  TERMINAL_FONTS,
  BELL_STYLES,
  FAST_SCROLL_MODIFIERS,
  CURSOR_STYLES,
} from "@/lib/terminal-themes";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { PasswordInput } from "@/components/password-input";
import { Slider } from "@/components/slider";
import {
  Activity,
  ArrowLeft,
  Box,
  Copy,
  Folder,
  FolderSearch,
  Globe,
  Info,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  Monitor,
  Network,
  MousePointerClick,
  Palette,
  Pencil,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  Tag,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { SectionCard, SettingRow, FakeSwitch } from "@/components/section-card";
import { TerminalPreview } from "@/features/terminal/TerminalPreview";
import {
  getSSHHosts,
  getCredentials,
  createSSHHost,
  updateSSHHost,
  createCredential,
  updateCredential,
  deleteCredential,
  generateKeyPair,
  generatePublicKeyFromPrivate,
  deployCredentialToHost,
  getSnippets,
  renameCredentialFolder,
  subscribeTunnelStatuses,
  connectTunnel,
  disconnectTunnel,
  getCredentialDetails,
} from "@/main-axios";
import type { SSHHostWithStatus } from "@/main-axios";

import type { Host, Credential } from "@/types/ui-types";
import { useTabsSafe } from "@/shell/TabContext";

function sshHostToHost(h: SSHHostWithStatus): Host {
  const parseJson = (v: any) => {
    if (!v) return undefined;
    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return undefined;
      }
    }
    return v;
  };
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: null,
    ram: null,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    hasKey: !!(h as any).hasKey || !!(typeof h.key === "string" && h.key),
    hasKeyPassword: !!(h as any).hasKeyPassword || !!h.keyPassword,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh != null ? h.enableSsh : h.connectionType === "ssh",
    enableTerminal:
      h.enableTerminal ??
      (h.enableSsh != null ? h.enableSsh : h.connectionType === "ssh"),
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableRdp: h.enableRdp != null ? h.enableRdp : h.connectionType === "rdp",
    enableVnc: h.enableVnc != null ? h.enableVnc : h.connectionType === "vnc",
    enableTelnet:
      h.enableTelnet != null ? h.enableTelnet : h.connectionType === "telnet",
    sshPort:
      h.sshPort ??
      (h.connectionType === "ssh" || !h.connectionType ? h.port : 22),
    rdpPort: h.rdpPort ?? (h.connectionType === "rdp" ? h.port : 3389),
    vncPort: h.vncPort ?? (h.connectionType === "vnc" ? h.port : 5900),
    telnetPort: h.telnetPort ?? (h.connectionType === "telnet" ? h.port : 23),
    rdpUser: h.rdpUser,
    rdpPassword: h.rdpPassword ?? "",
    domain: h.rdpDomain,
    security: h.rdpSecurity,
    ignoreCert: h.rdpIgnoreCert ?? false,
    vncPassword: h.vncPassword ?? "",
    vncUser: h.vncUser,
    telnetUser: h.telnetUser,
    telnetPassword: h.telnetPassword ?? "",
    quickActions: (h.quickActions ?? []).map((a: any) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    serverTunnels: parseJson(h.tunnelConnections) ?? [],
    jumpHosts: (parseJson(h.jumpHosts) ?? []).map((j: any) => ({
      hostId: String(j.hostId ?? j.hostid ?? j),
    })),
    portKnockSequence: parseJson(h.portKnockSequence) ?? [],
    defaultPath: h.defaultPath,
    terminalConfig: parseJson(h.terminalConfig) as Host["terminalConfig"],
    statsConfig: parseJson(h.statsConfig) as Host["statsConfig"],
    guacamoleConfig: parseJson(h.guacamoleConfig),
    forceKeyboardInteractive: h.forceKeyboardInteractive ?? false,
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: parseJson(h.socks5ProxyChain) ?? [],
    overrideCredentialUsername: h.overrideCredentialUsername ?? false,
  };
}

const HOST_TAB_IDS = [
  "general",
  "ssh",
  "tunnels",
  "docker",
  "files",
  "stats",
  "rdp",
  "vnc",
  "telnet",
] as const;
const CREDENTIAL_TAB_IDS = ["general", "auth"] as const;

type HostTab = {
  id: (typeof HOST_TAB_IDS)[number];
  label: string;
  icon: React.ReactNode;
};
type CredentialTab = {
  id: (typeof CREDENTIAL_TAB_IDS)[number];
  label: string;
  icon: React.ReactNode;
};

function makeHostTabs(t: (key: string) => string): HostTab[] {
  return [
    {
      id: "general",
      label: t("hosts.tabGeneral"),
      icon: <Settings className="size-3" />,
    },
    {
      id: "ssh",
      label: t("hosts.tabSsh"),
      icon: <Terminal className="size-3" />,
    },
    {
      id: "tunnels",
      label: t("hosts.tabTunnels"),
      icon: <Network className="size-3" />,
    },
    {
      id: "docker",
      label: t("hosts.tabDocker"),
      icon: <Box className="size-3" />,
    },
    {
      id: "files",
      label: t("hosts.tabFiles"),
      icon: <Folder className="size-3" />,
    },
    {
      id: "stats",
      label: t("hosts.tabStats"),
      icon: <Activity className="size-3" />,
    },
    {
      id: "rdp",
      label: t("hosts.tabRdp"),
      icon: <Monitor className="size-3" />,
    },
    {
      id: "vnc",
      label: t("hosts.tabVnc"),
      icon: <MousePointerClick className="size-3" />,
    },
    {
      id: "telnet",
      label: t("hosts.tabTelnet"),
      icon: <Terminal className="size-3" />,
    },
  ];
}

function makeCredentialTabs(t: (key: string) => string): CredentialTab[] {
  return [
    {
      id: "general",
      label: t("hosts.tabGeneral"),
      icon: <Settings className="size-3" />,
    },
    {
      id: "auth",
      label: t("hosts.tabAuthentication"),
      icon: <KeyRound className="size-3" />,
    },
  ];
}

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

function HostEditor({
  host,
  activeTab,
  onBack,
  onSave,
  protocols,
  onProtocolChange,
  onTabChange,
  onCredentialChange,
  hosts,
  credentials,
}: {
  host: Host | null;
  activeTab: string;
  onBack: () => void;
  onSave: (saved: any) => void;
  protocols: {
    enableSsh: boolean;
    enableRdp: boolean;
    enableVnc: boolean;
    enableTelnet: boolean;
  };
  onProtocolChange: (p: Partial<typeof protocols>) => void;
  onTabChange: (tab: string) => void;
  onCredentialChange: (credentialId: string) => void;
  hosts: Host[];
  credentials: { id: string; name: string; username: string }[];
}) {
  const { t } = useTranslation();
  const { setPreviewTerminalTheme } = useTabsSafe();
  const [form, setForm] = useState(() => {
    const rawTheme = host?.terminalConfig?.theme;
    const normalizedTheme =
      !rawTheme ||
      ["Termix Dark", "Termix Light", "termixDark", "termixLight"].includes(
        rawTheme,
      )
        ? "termix"
        : TERMINAL_THEMES[rawTheme]
          ? rawTheme
          : "termix";
    return {
      name: host?.name ?? "",
      ip: host?.ip ?? "",
      username: host?.username ?? "",
      sshPort: host?.sshPort ?? 22,
      rdpPort: host?.rdpPort ?? 3389,
      vncPort: host?.vncPort ?? 5900,
      telnetPort: host?.telnetPort ?? 23,
      authType: host?.authType ?? "password",
      password: host?.password ?? "",
      key: host?.key ?? (host?.hasKey ? "existing_key" : ""),
      keyPassword: host?.hasKeyPassword
        ? "existing_key_password"
        : (host?.keyPassword ?? ""),
      keyType: host?.keyType ?? "auto",
      keySubTab: "paste" as "paste" | "upload",
      credentialId: host?.credentialId ?? "",
      overrideCredentialUsername: host?.overrideCredentialUsername ?? false,
      folder: host?.folder ?? "",
      tags: host?.tags ?? ([] as string[]),
      tagInput: "",
      notes: host?.notes ?? "",
      pin: host?.pin ?? false,
      macAddress: host?.macAddress ?? "",
      useSocks5: host?.useSocks5 ?? false,
      socks5Host: host?.socks5Host ?? "",
      socks5Port: host?.socks5Port ?? 1080,
      socks5Username: host?.socks5Username ?? "",
      socks5Password: host?.socks5Password ?? "",
      socks5ProxyMode: ((host?.socks5ProxyChain as any[])?.length > 0
        ? "chain"
        : "single") as "single" | "chain",
      socks5ProxyChain: ((host?.socks5ProxyChain as any[]) ?? []) as {
        host: string;
        port: number;
        type: string;
        username: string;
        password: string;
      }[],
      enableTerminal: host?.enableTerminal ?? true,
      enableFileManager: host?.enableFileManager ?? false,
      enableDocker: host?.enableDocker ?? false,
      enableTunnel: host?.enableTunnel ?? false,
      defaultPath: host?.defaultPath ?? "/",
      forceKeyboardInteractive: host?.forceKeyboardInteractive ?? false,
      fontSize: host?.terminalConfig?.fontSize ?? 14,
      fontFamily:
        host?.terminalConfig?.fontFamily ?? "Caskaydia Cove Nerd Font Mono",
      theme: normalizedTheme,
      cursorStyle: (host?.terminalConfig?.cursorStyle ?? "bar") as
        | "block"
        | "underline"
        | "bar",
      cursorBlink: host?.terminalConfig?.cursorBlink ?? true,
      scrollback: host?.terminalConfig?.scrollback ?? 10000,
      letterSpacing: host?.terminalConfig?.letterSpacing ?? 0,
      lineHeight: host?.terminalConfig?.lineHeight ?? 1.0,
      bellStyle: (host?.terminalConfig?.bellStyle ?? "none") as
        | "none"
        | "sound"
        | "visual"
        | "both",
      rightClickSelectsWord:
        host?.terminalConfig?.rightClickSelectsWord ?? false,
      fastScrollModifier: (host?.terminalConfig?.fastScrollModifier ??
        "alt") as "alt" | "ctrl" | "shift",
      fastScrollSensitivity: host?.terminalConfig?.fastScrollSensitivity ?? 5,
      minimumContrastRatio: host?.terminalConfig?.minimumContrastRatio ?? 1,
      backspaceMode: (host?.terminalConfig?.backspaceMode ?? "normal") as
        | "normal"
        | "control-h",
      startupSnippetId: host?.terminalConfig?.startupSnippetId ?? null,
      moshCommand: host?.terminalConfig?.moshCommand ?? "",
      agentForwarding: host?.terminalConfig?.agentForwarding ?? false,
      autoMosh: host?.terminalConfig?.autoMosh ?? false,
      autoTmux: host?.terminalConfig?.autoTmux ?? false,
      sudoPasswordAutoFill: host?.terminalConfig?.sudoPasswordAutoFill ?? false,
      sudoPassword: host?.terminalConfig?.sudoPassword ?? "",
      keepaliveInterval: host?.terminalConfig?.keepaliveInterval ?? 30,
      keepaliveCountMax: host?.terminalConfig?.keepaliveCountMax ?? 3,
      environmentVariables:
        host?.terminalConfig?.environmentVariables ??
        ([] as { key: string; value: string }[]),
      serverTunnels: host?.serverTunnels ?? ([] as Host["serverTunnels"]),
      jumpHosts: host?.jumpHosts ?? ([] as { hostId: string }[]),
      portKnockSequence:
        host?.portKnockSequence ??
        ([] as { port: number; protocol: "tcp" | "udp"; delay: number }[]),
      quickActions:
        host?.quickActions ?? ([] as { name: string; snippetId: string }[]),
      rdpUser: host?.rdpUser ?? "",
      rdpPassword: host?.rdpPassword ?? "",
      domain: host?.domain ?? "",
      security: host?.security ?? "",
      ignoreCert: host?.ignoreCert ?? false,
      vncPassword: host?.vncPassword ?? "",
      vncUser: host?.vncUser ?? "",
      telnetUser: host?.telnetUser ?? "",
      telnetPassword: host?.telnetPassword ?? "",
      guacamoleConfig: host?.guacamoleConfig ?? ({} as Record<string, any>),
      statsConfig: host?.statsConfig ?? {
        statusCheckEnabled: true,
        statusCheckInterval: 60,
        useGlobalStatusInterval: true,
        metricsEnabled: true,
        metricsInterval: 30,
        useGlobalMetricsInterval: true,
        enabledWidgets: [
          "cpu",
          "memory",
          "disk",
          "network",
          "uptime",
          "system",
          "login_stats",
          "processes",
          "ports",
          "firewall",
        ],
      },
    };
  });

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const setGuacField = (key: string, value: any) =>
    setField("guacamoleConfig", { ...form.guacamoleConfig, [key]: value });

  const [saving, setSaving] = useState(false);
  const [snippets, setSnippets] = useState<{ id: number; name: string }[]>([]);
  const [tunnelStatuses, setTunnelStatuses] = useState<Record<string, any>>({});
  const [connectingTunnel, setConnectingTunnel] = useState<number | null>(null);

  useEffect(() => {
    getSnippets()
      .then((res: any) => {
        const arr = Array.isArray(res) ? res : (res?.snippets ?? []);
        setSnippets(
          arr.map((s: any) => ({
            id: s.id,
            name: s.name ?? s.title ?? `Snippet ${s.id}`,
          })),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab !== "tunnels") return;
    const unsub = subscribeTunnelStatuses((s) => setTunnelStatuses(s));
    return unsub;
  }, [activeTab]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = form.tags;
      const data = {
        connectionType: protocols.enableSsh
          ? "ssh"
          : protocols.enableRdp
            ? "rdp"
            : protocols.enableVnc
              ? "vnc"
              : "telnet",
        name: form.name,
        ip: form.ip,
        port: protocols.enableSsh
          ? Number(form.sshPort)
          : protocols.enableRdp
            ? Number(form.rdpPort)
            : protocols.enableVnc
              ? Number(form.vncPort)
              : Number(form.telnetPort),
        username: form.username,
        folder: form.folder,
        tags,
        pin: form.pin,
        authType: form.authType,
        password: form.password || null,
        key: form.key === "existing_key" ? undefined : form.key || null,
        keyPassword:
          form.keyPassword === "existing_key_password"
            ? undefined
            : form.keyPassword || null,
        keyType: form.keyType !== "auto" ? form.keyType : null,
        credentialId: form.credentialId ? Number(form.credentialId) : null,
        overrideCredentialUsername: form.overrideCredentialUsername,
        notes: form.notes,
        macAddress: form.macAddress || null,
        enableTerminal: form.enableTerminal,
        enableTunnel: form.enableTunnel,
        enableFileManager: form.enableFileManager,
        enableDocker: form.enableDocker,
        defaultPath: form.defaultPath || "/",
        useSocks5: form.useSocks5,
        socks5Host:
          form.socks5ProxyMode === "single" ? form.socks5Host || null : null,
        socks5Port:
          form.socks5ProxyMode === "single" ? form.socks5Port || null : null,
        socks5Username:
          form.socks5ProxyMode === "single"
            ? form.socks5Username || null
            : null,
        socks5Password:
          form.socks5ProxyMode === "single"
            ? form.socks5Password || null
            : null,
        socks5ProxyChain:
          form.socks5ProxyMode === "chain" ? form.socks5ProxyChain : null,
        enableSsh: protocols.enableSsh,
        enableRdp: protocols.enableRdp,
        enableVnc: protocols.enableVnc,
        enableTelnet: protocols.enableTelnet,
        sshPort: Number(form.sshPort),
        rdpPort: Number(form.rdpPort),
        vncPort: Number(form.vncPort),
        telnetPort: Number(form.telnetPort),
        forceKeyboardInteractive: form.forceKeyboardInteractive,
        rdpUser: form.rdpUser || null,
        rdpPassword: form.rdpPassword || null,
        rdpDomain: form.domain || null,
        rdpSecurity: form.security || null,
        rdpIgnoreCert: form.ignoreCert,
        vncPassword: form.vncPassword || null,
        vncUser: form.vncUser || null,
        telnetUser: form.telnetUser || null,
        telnetPassword: form.telnetPassword || null,
        jumpHosts: form.jumpHosts,
        portKnockSequence: form.portKnockSequence,
        tunnelConnections: form.serverTunnels,
        quickActions: form.quickActions.map((a) => ({
          name: a.name,
          snippetId: Number(a.snippetId),
        })),
        statsConfig: form.statsConfig,
        guacamoleConfig:
          (protocols.enableRdp ||
            protocols.enableVnc ||
            protocols.enableTelnet) &&
          Object.keys(form.guacamoleConfig).length > 0
            ? form.guacamoleConfig
            : null,
        terminalConfig: protocols.enableSsh
          ? {
              theme: form.theme,
              cursorBlink: form.cursorBlink,
              cursorStyle: form.cursorStyle,
              fontSize: Number(form.fontSize),
              fontFamily: form.fontFamily,
              scrollback: Number(form.scrollback),
              letterSpacing: Number(form.letterSpacing),
              lineHeight: Number(form.lineHeight),
              bellStyle: form.bellStyle,
              rightClickSelectsWord: form.rightClickSelectsWord,
              fastScrollModifier: form.fastScrollModifier,
              fastScrollSensitivity: Number(form.fastScrollSensitivity),
              minimumContrastRatio: Number(form.minimumContrastRatio),
              backspaceMode: form.backspaceMode,
              startupSnippetId: form.startupSnippetId ?? null,
              moshCommand: form.moshCommand || null,
              agentForwarding: form.agentForwarding,
              autoMosh: form.autoMosh,
              autoTmux: form.autoTmux,
              sudoPasswordAutoFill: form.sudoPasswordAutoFill,
              sudoPassword: form.sudoPassword || null,
              keepaliveInterval: Number(form.keepaliveInterval),
              keepaliveCountMax: Number(form.keepaliveCountMax),
              environmentVariables: form.environmentVariables,
            }
          : null,
      };
      const saved = host
        ? await updateSSHHost(Number(host.id), data as any)
        : await createSSHHost(data as any);
      toast.success(host ? t("hosts.hostUpdated") : t("hosts.hostCreated"));
      setPreviewTerminalTheme(null);
      onSave(saved);
    } catch {
      toast.error(t("hosts.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const authMethod = form.authType;
  const selectedCredential = credentials.find(
    (c) => c.id === form.credentialId,
  );

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
              title={t("hosts.protocols")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 py-3">
                {[
                  {
                    proto: "enableSsh" as const,
                    label: t("hosts.tabSsh"),
                    desc: t("hosts.secureShell"),
                    icon: <Terminal className="size-4" />,
                    portField: "sshPort" as const,
                  },
                  {
                    proto: "enableRdp" as const,
                    label: t("hosts.tabRdp"),
                    desc: t("hosts.remoteDesktop"),
                    icon: <Monitor className="size-4" />,
                    portField: "rdpPort" as const,
                  },
                  {
                    proto: "enableVnc" as const,
                    label: t("hosts.tabVnc"),
                    desc: t("hosts.virtualNetwork"),
                    icon: <MousePointerClick className="size-4" />,
                    portField: "vncPort" as const,
                  },
                  {
                    proto: "enableTelnet" as const,
                    label: t("hosts.tabTelnet"),
                    desc: t("hosts.unencryptedShell"),
                    icon: <Terminal className="size-4" />,
                    portField: "telnetPort" as const,
                  },
                ].map(({ proto, label, desc, icon, portField }) => {
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
                      </div>
                      <FakeSwitch
                        checked={enabled}
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
              title={t("hosts.connectionDetails")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.addressIp")}
                  </label>
                  <Input
                    placeholder="10.0.0.1 or example.com"
                    value={form.ip}
                    onChange={(e) => setField("ip", e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.friendlyName")}
                    </label>
                    <Input
                      placeholder="e.g. Web Server Production"
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                    />
                  </div>
                  {protocols.enableSsh && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        MAC Address
                      </label>
                      <Input
                        placeholder="AA:BB:CC:DD:EE:FF"
                        value={form.macAddress}
                        onChange={(e) => setField("macAddress", e.target.value)}
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
                  <span>{t("hosts.enableAtLeastOneProtocol")}</span>
                </div>
              )}

            <SectionCard
              title={t("hosts.folderAndAdvanced")}
              icon={<Tag className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.folder")}
                  </label>
                  <Input
                    placeholder="e.g. Production"
                    value={form.folder}
                    onChange={(e) => setField("folder", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.tags")}
                  </label>
                  <div className="flex flex-wrap items-center gap-1 min-h-9 px-2 py-1 border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
                    {form.tags.map((tag) => (
                      <span
                        key={tag}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted border border-border/60 text-foreground"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() =>
                            setField(
                              "tags",
                              form.tags.filter((tg) => tg !== tag),
                            )
                          }
                          className="text-muted-foreground hover:text-destructive ml-0.5"
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                    <input
                      className="flex-1 min-w-16 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                      placeholder={
                        form.tags.length === 0 ? t("hosts.addTag") : ""
                      }
                      value={form.tagInput}
                      onChange={(e) => setField("tagInput", e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          (e.key === " " || e.key === "Enter") &&
                          form.tagInput.trim()
                        ) {
                          e.preventDefault();
                          const tag = form.tagInput.trim();
                          if (!form.tags.includes(tag))
                            setField("tags", [...form.tags, tag]);
                          setField("tagInput", "");
                        } else if (
                          e.key === "Backspace" &&
                          !form.tagInput &&
                          form.tags.length > 0
                        ) {
                          setField("tags", form.tags.slice(0, -1));
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.privateNotes")}
                  </label>
                  <textarea
                    rows={3}
                    placeholder={t("hosts.privateNotesPlaceholder")}
                    className="w-full px-3 py-2 text-xs bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring"
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                  />
                </div>
                <SettingRow
                  label={t("hosts.pinToTop")}
                  description={t("hosts.pinToTopDesc")}
                >
                  <FakeSwitch
                    checked={form.pin}
                    onChange={(v) => setField("pin", v)}
                  />
                </SettingRow>
              </div>
              <div className="flex flex-col gap-3 border-t border-border pt-4 pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.portKnockingSequence")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                    onClick={() =>
                      setField("portKnockSequence", [
                        ...form.portKnockSequence,
                        { port: 0, protocol: "tcp" as const, delay: 0 },
                      ])
                    }
                  >
                    <Plus className="size-3 mr-1" /> {t("hosts.addKnockBtn")}
                  </Button>
                </div>
                {form.portKnockSequence.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/50">
                    {t("hosts.noPortKnocking")}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {form.portKnockSequence.map((knock, i) => (
                    <div
                      key={i}
                      className="flex items-end gap-1.5 p-1.5 bg-muted/30 border border-border"
                    >
                      <span className="text-[9px] font-bold text-muted-foreground/50 mb-1.5 shrink-0">
                        {i + 1}.
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                          {t("hosts.knockPort")}
                        </span>
                        <Input
                          className="h-7 text-xs w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="8080"
                          type="number"
                          value={knock.port}
                          onChange={(e) => {
                            const updated = [...form.portKnockSequence];
                            updated[i] = {
                              ...updated[i],
                              port: Number(e.target.value),
                            };
                            setField("portKnockSequence", updated);
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                          {t("hosts.protocol")}
                        </span>
                        <select
                          className="h-7 text-[10px] bg-background border border-border px-1"
                          value={knock.protocol}
                          onChange={(e) => {
                            const updated = [...form.portKnockSequence];
                            updated[i] = {
                              ...updated[i],
                              protocol: e.target.value as "tcp" | "udp",
                            };
                            setField("portKnockSequence", updated);
                          }}
                        >
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wide px-0.5">
                          {t("hosts.delayAfterMs")}
                        </span>
                        <Input
                          className="h-7 text-xs w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          placeholder="100"
                          type="number"
                          value={knock.delay}
                          onChange={(e) => {
                            const updated = [...form.portKnockSequence];
                            updated[i] = {
                              ...updated[i],
                              delay: Number(e.target.value),
                            };
                            setField("portKnockSequence", updated);
                          }}
                        />
                      </div>
                      <button
                        className="text-destructive p-1 mb-0.5"
                        onClick={() =>
                          setField(
                            "portKnockSequence",
                            form.portKnockSequence.filter(
                              (_, idx) => idx !== i,
                            ),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-4 border-t border-border pt-4 pb-2">
                <SettingRow
                  label={t("hosts.useSocks5Proxy")}
                  description={t("hosts.useSocks5ProxyDesc")}
                >
                  <FakeSwitch
                    checked={form.useSocks5}
                    onChange={(v) => setField("useSocks5", v)}
                  />
                </SettingRow>
                {form.useSocks5 && (
                  <div className="flex flex-col gap-3">
                    {/* Single / Chain mode toggle */}
                    <div className="flex gap-2">
                      {(["single", "chain"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setField("socks5ProxyMode", m)}
                          className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${form.socks5ProxyMode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {m === "single"
                            ? t("hosts.proxySingleMode")
                            : t("hosts.proxyChainMode")}
                        </button>
                      ))}
                    </div>

                    {form.socks5ProxyMode === "single" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-muted/20 border border-border">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyHost")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="proxy.example.com"
                            value={form.socks5Host}
                            onChange={(e) =>
                              setField("socks5Host", e.target.value)
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyPort")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            type="number"
                            placeholder="1080"
                            value={form.socks5Port}
                            onChange={(e) =>
                              setField(
                                "socks5Port",
                                Number(e.target.value) as any,
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyUsername")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder={t("hosts.optional")}
                            value={form.socks5Username}
                            onChange={(e) =>
                              setField("socks5Username", e.target.value)
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.proxyPassword")}
                          </label>
                          <PasswordInput
                            className="h-7 text-xs pr-8"
                            placeholder={t("hosts.optional")}
                            value={form.socks5Password}
                            onChange={(e) =>
                              setField("socks5Password", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    )}

                    {form.socks5ProxyMode === "chain" && (
                      <div className="flex flex-col gap-2">
                        {form.socks5ProxyChain.map((node, ni) => (
                          <div
                            key={ni}
                            className="flex flex-col gap-2 p-3 bg-muted/20 border border-border"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-muted-foreground">
                                {t("hosts.proxyNode")} {ni + 1}
                              </span>
                              <button
                                type="button"
                                className="text-destructive"
                                onClick={() =>
                                  setField(
                                    "socks5ProxyChain",
                                    form.socks5ProxyChain.filter(
                                      (_, idx) => idx !== ni,
                                    ),
                                  )
                                }
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  {t("hosts.proxyHost")}
                                </label>
                                <Input
                                  className="h-7 text-xs"
                                  placeholder="proxy.example.com"
                                  value={node.host}
                                  onChange={(e) => {
                                    const u = [...form.socks5ProxyChain];
                                    u[ni] = { ...u[ni], host: e.target.value };
                                    setField("socks5ProxyChain", u);
                                  }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  {t("hosts.proxyPort")}
                                </label>
                                <Input
                                  className="h-7 text-xs"
                                  type="number"
                                  placeholder="1080"
                                  value={node.port}
                                  onChange={(e) => {
                                    const u = [...form.socks5ProxyChain];
                                    u[ni] = {
                                      ...u[ni],
                                      port: Number(e.target.value),
                                    };
                                    setField("socks5ProxyChain", u);
                                  }}
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  {t("hosts.proxyType")}
                                </label>
                                <select
                                  className="h-7 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                                  value={node.type}
                                  onChange={(e) => {
                                    const u = [...form.socks5ProxyChain];
                                    u[ni] = { ...u[ni], type: e.target.value };
                                    setField("socks5ProxyChain", u);
                                  }}
                                >
                                  <option value="socks5">SOCKS5</option>
                                  <option value="socks4">SOCKS4</option>
                                  <option value="http">HTTP</option>
                                </select>
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  {t("hosts.proxyUsername")}
                                </label>
                                <Input
                                  className="h-7 text-xs"
                                  placeholder={t("hosts.optional")}
                                  value={node.username}
                                  onChange={(e) => {
                                    const u = [...form.socks5ProxyChain];
                                    u[ni] = {
                                      ...u[ni],
                                      username: e.target.value,
                                    };
                                    setField("socks5ProxyChain", u);
                                  }}
                                />
                              </div>
                              <div className="flex flex-col gap-1 col-span-2">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                                  {t("hosts.proxyPassword")}
                                </label>
                                <PasswordInput
                                  className="h-7 text-xs pr-8"
                                  placeholder={t("hosts.optional")}
                                  value={node.password}
                                  onChange={(e) => {
                                    const u = [...form.socks5ProxyChain];
                                    u[ni] = {
                                      ...u[ni],
                                      password: e.target.value,
                                    };
                                    setField("socks5ProxyChain", u);
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand self-start"
                          onClick={() =>
                            setField("socks5ProxyChain", [
                              ...form.socks5ProxyChain,
                              {
                                host: "",
                                port: 1080,
                                type: "socks5",
                                username: "",
                                password: "",
                              },
                            ])
                          }
                        >
                          <Plus className="size-3 mr-1" />{" "}
                          {t("hosts.addProxyNode")}
                        </Button>
                      </div>
                    )}

                    {/* Connection path visualization */}
                    {(form.socks5ProxyMode === "single" && form.socks5Host) ||
                    (form.socks5ProxyMode === "chain" &&
                      form.socks5ProxyChain.length > 0) ? (
                      <div className="flex items-center gap-1 flex-wrap p-2 bg-muted/30 border border-border text-[10px]">
                        <span className="px-2 py-0.5 bg-background border border-border text-foreground font-mono">
                          {t("hosts.you")}
                        </span>
                        {form.socks5ProxyMode === "single" &&
                        form.socks5Host ? (
                          <>
                            <span className="text-muted-foreground">→</span>
                            <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                              {form.socks5Host}:{form.socks5Port}
                            </span>
                          </>
                        ) : (
                          form.socks5ProxyChain
                            .filter((n) => n.host)
                            .map((n, ni) => (
                              <React.Fragment key={ni}>
                                <span className="text-muted-foreground">→</span>
                                <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                                  {n.host}:{n.port}
                                </span>
                              </React.Fragment>
                            ))
                        )}
                        {form.jumpHosts
                          .filter((j) => j.hostId)
                          .map((j, ji) => {
                            const jh = hosts.find((h) => h.id === j.hostId);
                            return jh ? (
                              <React.Fragment key={`j${ji}`}>
                                <span className="text-muted-foreground">→</span>
                                <span className="px-2 py-0.5 bg-muted border border-border text-muted-foreground font-mono">
                                  {jh.name || jh.ip}
                                </span>
                              </React.Fragment>
                            ) : null;
                          })}
                        <span className="text-muted-foreground">→</span>
                        <span className="px-2 py-0.5 bg-accent-brand/10 border border-accent-brand/30 text-accent-brand font-mono">
                          {form.ip || "target"}:{form.sshPort}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.jumpHostChainLabel")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                      onClick={() =>
                        setField("jumpHosts", [
                          ...form.jumpHosts,
                          { hostId: "" },
                        ])
                      }
                    >
                      <Plus className="size-3 mr-1" /> {t("hosts.addJumpBtn")}
                    </Button>
                  </div>
                  {form.jumpHosts.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/50">
                      {t("hosts.noJumpHosts")}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {form.jumpHosts.map((jh, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 p-2 bg-background border border-border"
                      >
                        <span className="text-[10px] font-bold text-muted-foreground shrink-0">
                          {i + 1}.
                        </span>
                        <select
                          className="flex h-7 flex-1 border border-border bg-background px-2 py-0 text-xs outline-none focus:ring-1 focus:ring-ring"
                          value={jh.hostId}
                          onChange={(e) => {
                            const updated = [...form.jumpHosts];
                            updated[i] = { hostId: e.target.value };
                            setField("jumpHosts", updated);
                          }}
                        >
                          <option value="">{t("hosts.selectAServer")}</option>
                          {hosts
                            .filter((h) => (host ? h.id !== host.id : true))
                            .map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name || h.ip}
                              </option>
                            ))}
                        </select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive"
                          onClick={() =>
                            setField(
                              "jumpHosts",
                              form.jumpHosts.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "ssh" && (
          <>
            <SectionCard
              title={t("hosts.connectionLabel")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.sshPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="22"
                    value={form.sshPort}
                    onChange={(e) =>
                      setField("sshPort", Number(e.target.value) as any)
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.authenticationLabel")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.authMethod")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["password", "key", "credential", "none", "opkssh"].map(
                      (m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setField("authType", m as any);
                            if (m !== "credential") onCredentialChange("");
                            else onCredentialChange(form.credentialId);
                          }}
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
                      {t("hosts.username")}
                    </label>
                    <Input
                      placeholder="root"
                      value={form.username}
                      disabled={
                        authMethod === "credential" &&
                        !!selectedCredential?.username &&
                        !form.overrideCredentialUsername
                      }
                      onChange={(e) => setField("username", e.target.value)}
                    />
                  </div>
                  {authMethod === "password" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.password")}
                      </label>
                      <PasswordInput
                        className="h-8 text-xs pr-8"
                        placeholder="••••••••"
                        value={form.password}
                        onChange={(e) => setField("password", e.target.value)}
                      />
                    </div>
                  )}
                  {authMethod === "key" && (
                    <>
                      <div className="flex flex-col gap-1.5 col-span-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            {t("hosts.sshPrivateKey")}
                          </label>
                          <div className="flex gap-1">
                            {(["paste", "upload"] as const).map((tab) => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setField("keySubTab", tab)}
                                className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest border transition-colors ${form.keySubTab === tab ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                              >
                                {tab === "paste"
                                  ? t("hosts.keyPasteTab")
                                  : t("hosts.keyUploadTab")}
                              </button>
                            ))}
                          </div>
                        </div>
                        {form.keySubTab === "paste" ? (
                          <div className="flex flex-col gap-1.5">
                            {form.key === "existing_key" && (
                              <div className="px-3 py-2 text-[10px] border border-accent-brand/30 bg-accent-brand/5 text-accent-brand">
                                {t("hosts.keySaved")} —{" "}
                                {t("hosts.keyReplaceNotice")}
                              </div>
                            )}
                            <textarea
                              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                              rows={5}
                              value={
                                form.key === "existing_key" ? "" : form.key
                              }
                              onChange={(e) => setField("key", e.target.value)}
                              className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <label
                              className={`flex items-center justify-center gap-2 h-16 border-2 border-dashed cursor-pointer transition-colors ${form.key ? "border-accent-brand/40 bg-accent-brand/5 text-accent-brand" : "border-border text-muted-foreground hover:border-accent-brand/30 hover:text-foreground"}`}
                            >
                              <Upload className="size-4" />
                              <span className="text-xs">
                                {form.key === "existing_key"
                                  ? t("hosts.keySaved")
                                  : form.key
                                    ? t("hosts.keyFileLoaded")
                                    : t("hosts.keyUploadClick")}
                              </span>
                              <input
                                type="file"
                                accept=".pem,.key,.txt,.ppk"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const text = await file.text();
                                  setField("key", text);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {form.key && (
                              <button
                                type="button"
                                onClick={() => setField("key", "")}
                                className="text-[10px] text-destructive self-start"
                              >
                                {form.key === "existing_key"
                                  ? t("hosts.replaceKey")
                                  : t("hosts.clearKey")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.keyPassphrase")}
                        </label>
                        <PasswordInput
                          className="h-8 text-xs pr-8"
                          placeholder={
                            form.keyPassword === "existing_key_password"
                              ? t("hosts.keyPassphraseSaved")
                              : t("hosts.optional")
                          }
                          value={
                            form.keyPassword === "existing_key_password"
                              ? ""
                              : form.keyPassword
                          }
                          onFocus={() => {
                            if (form.keyPassword === "existing_key_password")
                              setField("keyPassword", "");
                          }}
                          onChange={(e) =>
                            setField("keyPassword", e.target.value)
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.keyTypeLabel")}
                        </label>
                        <select
                          value={form.keyType}
                          onChange={(e) =>
                            setField("keyType", e.target.value as any)
                          }
                          className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="auto">{t("hosts.keyTypeAuto")}</option>
                          <option value="ssh-rsa">RSA</option>
                          <option value="ssh-ed25519">Ed25519</option>
                          <option value="ecdsa-sha2-nistp256">
                            ECDSA P-256
                          </option>
                          <option value="ecdsa-sha2-nistp384">
                            ECDSA P-384
                          </option>
                          <option value="ecdsa-sha2-nistp521">
                            ECDSA P-521
                          </option>
                          <option value="ssh-dss">DSA</option>
                          <option value="ssh-rsa-sha2-256">RSA SHA2-256</option>
                          <option value="ssh-rsa-sha2-512">RSA SHA2-512</option>
                        </select>
                      </div>
                    </>
                  )}
                  {authMethod === "credential" && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {t("hosts.storedCredential")}
                        </label>
                        <select
                          value={form.credentialId}
                          onChange={(e) => {
                            const newId = e.target.value;
                            setField("credentialId", newId);
                            onCredentialChange(newId);
                            if (!form.overrideCredentialUsername) {
                              const cred = credentials.find(
                                (c) => c.id === newId,
                              );
                              if (cred?.username)
                                setField("username", cred.username);
                            }
                          }}
                          className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="">
                            {t("hosts.selectACredential")}
                          </option>
                          {credentials.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.username
                                ? `${c.name} (${c.username})`
                                : c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {selectedCredential?.username && (
                        <div className="flex items-center justify-between col-span-2 pt-1">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium">
                              {t("hosts.overrideCredentialUsername")}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {t("hosts.overrideCredentialUsernameDesc")}
                            </span>
                          </div>
                          <FakeSwitch
                            checked={form.overrideCredentialUsername}
                            onChange={(v) => {
                              setField("overrideCredentialUsername", v);
                              if (!v && selectedCredential?.username) {
                                setField(
                                  "username",
                                  selectedCredential.username,
                                );
                              }
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
                <SettingRow
                  label={t("hosts.forceKeyboardInteractiveLabel")}
                  description={t("hosts.forceKeyboardInteractiveShortDesc")}
                >
                  <FakeSwitch
                    checked={form.forceKeyboardInteractive}
                    onChange={(v) => setField("forceKeyboardInteractive", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.terminalAppearance")}
              icon={<Palette className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.themePreview")}
                  </label>
                  <TerminalPreview
                    theme={form.theme}
                    fontSize={form.fontSize}
                    fontFamily={form.fontFamily}
                    cursorStyle={form.cursorStyle}
                    cursorBlink={form.cursorBlink}
                    letterSpacing={form.letterSpacing}
                    lineHeight={form.lineHeight}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.colorTheme")}
                    </label>
                    <select
                      value={form.theme}
                      onChange={(e) => {
                        setField("theme", e.target.value);
                        setPreviewTerminalTheme(e.target.value);
                      }}
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {Object.entries(TERMINAL_THEMES)
                        .filter(
                          ([key]) =>
                            key !== "termixDark" && key !== "termixLight",
                        )
                        .map(([key, theme]) => (
                          <option key={key} value={key}>
                            {theme.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.fontFamilyLabel")}
                    </label>
                    <select
                      value={form.fontFamily}
                      onChange={(e) => setField("fontFamily", e.target.value)}
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring font-mono"
                    >
                      {TERMINAL_FONTS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.fontSizeLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.fontSize}px
                      </span>
                    </div>
                    <Slider
                      min={8}
                      max={24}
                      step={1}
                      value={[form.fontSize]}
                      onValueChange={([v]) => setField("fontSize", v as any)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.cursorStyleLabel")}
                    </label>
                    <select
                      value={form.cursorStyle}
                      onChange={(e) =>
                        setField("cursorStyle", e.target.value as any)
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {CURSOR_STYLES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.letterSpacingPx")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.letterSpacing}px
                      </span>
                    </div>
                    <Slider
                      min={-2}
                      max={10}
                      step={0.5}
                      value={[form.letterSpacing]}
                      onValueChange={([v]) =>
                        setField("letterSpacing", v as any)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.lineHeightLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.lineHeight.toFixed(1)}
                      </span>
                    </div>
                    <Slider
                      min={1.0}
                      max={2.0}
                      step={0.1}
                      value={[form.lineHeight]}
                      onValueChange={([v]) => setField("lineHeight", v as any)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.bellStyleLabel")}
                    </label>
                    <select
                      value={form.bellStyle}
                      onChange={(e) =>
                        setField("bellStyle", e.target.value as any)
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {BELL_STYLES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.backspaceModeLabel")}
                    </label>
                    <select
                      value={form.backspaceMode}
                      onChange={(e) =>
                        setField("backspaceMode", e.target.value as any)
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="normal">Normal (DEL)</option>
                      <option value="control-h">Control-H (BS)</option>
                    </select>
                  </div>
                </div>
                <SettingRow
                  label={t("hosts.cursorBlinking")}
                  description={t("hosts.cursorBlinkingDesc")}
                >
                  <FakeSwitch
                    checked={form.cursorBlink}
                    onChange={(v) => setField("cursorBlink", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.rightClickSelectsWordLabel")}
                  description={t("hosts.rightClickSelectsWordShortDesc")}
                >
                  <FakeSwitch
                    checked={form.rightClickSelectsWord}
                    onChange={(v) => setField("rightClickSelectsWord", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.behaviorAndAdvanced")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.scrollbackBufferLabel")}
                    </label>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {form.scrollback.toLocaleString()}{" "}
                      {t("hosts.scrollbackMaxLines")}
                    </span>
                  </div>
                  <Slider
                    min={1000}
                    max={100000}
                    step={1000}
                    value={[form.scrollback]}
                    onValueChange={([v]) => setField("scrollback", v as any)}
                  />
                </div>
                <SettingRow
                  label={t("hosts.sshAgentForwardingLabel")}
                  description={t("hosts.sshAgentForwardingShortDesc")}
                >
                  <FakeSwitch
                    checked={form.agentForwarding}
                    onChange={(v) => setField("agentForwarding", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableAutoMosh")}
                  description={t("hosts.enableAutoMoshDesc")}
                >
                  <FakeSwitch
                    checked={form.autoMosh}
                    onChange={(v) => setField("autoMosh", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.enableAutoTmux")}
                  description={t("hosts.enableAutoTmuxDesc")}
                >
                  <FakeSwitch
                    checked={form.autoTmux}
                    onChange={(v) => setField("autoTmux", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.sudoPasswordAutoFillLabel")}
                  description={t("hosts.sudoPasswordAutoFillShortDesc")}
                >
                  <FakeSwitch
                    checked={form.sudoPasswordAutoFill}
                    onChange={(v) => setField("sudoPasswordAutoFill", v)}
                  />
                </SettingRow>
                {form.sudoPasswordAutoFill && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.sudoPasswordLabel")}
                    </label>
                    <PasswordInput
                      className="h-8 text-xs pr-8"
                      placeholder="••••••••"
                      value={form.sudoPassword}
                      onChange={(e) => setField("sudoPassword", e.target.value)}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.environmentVariablesLabel")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                      onClick={() =>
                        setField("environmentVariables", [
                          ...form.environmentVariables,
                          { key: "", value: "" },
                        ])
                      }
                    >
                      <Plus className="size-3 mr-1" />{" "}
                      {t("hosts.addVariableBtn")}
                    </Button>
                  </div>
                  {form.environmentVariables.length === 0 && (
                    <p className="text-[10px] text-muted-foreground/50">
                      {t("hosts.noEnvVars")}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {form.environmentVariables.map((ev, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="KEY"
                          value={ev.key}
                          onChange={(e) => {
                            const updated = [...form.environmentVariables];
                            updated[i] = { ...updated[i], key: e.target.value };
                            setField("environmentVariables", updated);
                          }}
                        />
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="VALUE"
                          value={ev.value}
                          onChange={(e) => {
                            const updated = [...form.environmentVariables];
                            updated[i] = {
                              ...updated[i],
                              value: e.target.value,
                            };
                            setField("environmentVariables", updated);
                          }}
                        />
                        <button
                          className="text-destructive"
                          onClick={() =>
                            setField(
                              "environmentVariables",
                              form.environmentVariables.filter(
                                (_, idx) => idx !== i,
                              ),
                            )
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.fastScrollModifierLabel")}
                    </label>
                    <select
                      value={form.fastScrollModifier}
                      onChange={(e) =>
                        setField("fastScrollModifier", e.target.value as any)
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      {FAST_SCROLL_MODIFIERS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {t("hosts.fastScrollSensitivityLabel")}
                      </label>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {form.fastScrollSensitivity}
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={10}
                      step={1}
                      value={[form.fastScrollSensitivity]}
                      onValueChange={([v]) =>
                        setField("fastScrollSensitivity", v as any)
                      }
                    />
                  </div>
                </div>
                {form.autoMosh && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.moshCommandLabel")}
                    </label>
                    <Input
                      placeholder="mosh"
                      value={form.moshCommand}
                      onChange={(e) => setField("moshCommand", e.target.value)}
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.startupSnippetLabel")}
                    </label>
                    <select
                      value={form.startupSnippetId ?? ""}
                      onChange={(e) =>
                        setField(
                          "startupSnippetId",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">{t("hosts.none")}</option>
                      {snippets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.keepaliveIntervalLabel")}
                    </label>
                    <Input
                      type="number"
                      value={form.keepaliveInterval}
                      onChange={(e) =>
                        setField(
                          "keepaliveInterval",
                          Number(e.target.value) as any,
                        )
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.maxKeepaliveMisses")}
                    </label>
                    <Input
                      type="number"
                      value={form.keepaliveCountMax}
                      onChange={(e) =>
                        setField(
                          "keepaliveCountMax",
                          Number(e.target.value) as any,
                        )
                      }
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "tunnels" && (
          <>
            <SectionCard
              title={t("hosts.tunnelSettings")}
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.enableTunneling")}
                  description={t("hosts.enableTunnelingDesc")}
                >
                  <FakeSwitch
                    checked={form.enableTunnel}
                    onChange={(v) => setField("enableTunnel", v)}
                  />
                </SettingRow>
                <div className="text-xs text-muted-foreground p-3 bg-muted/30 border border-border space-y-1">
                  <p>{t("hosts.tunnelRequirementsText")}</p>
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.serverTunnelsSection")}
              icon={<Network className="size-3.5" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                  onClick={() =>
                    setField("serverTunnels", [
                      ...form.serverTunnels,
                      {
                        mode: "local" as const,
                        sourcePort: 8080,
                        endpointHost: "",
                        endpointPort: 80,
                        bindHost: "127.0.0.1",
                        maxRetries: 3,
                        retryInterval: 10,
                        autoStart: false,
                      },
                    ])
                  }
                >
                  <Plus className="size-3 mr-1" /> {t("hosts.addTunnelBtn")}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-3">
                {form.serverTunnels.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/50 px-1">
                    {t("hosts.noTunnelsConfigured")}
                  </p>
                )}
                {form.serverTunnels.map((tun, i) => {
                  const tunnelName = `${host?.id ?? "new"}-${i}-${tun.sourcePort}`;
                  const tunnelStatus = tunnelStatuses[tunnelName]?.status as
                    | string
                    | undefined;
                  const isConnected = tunnelStatus === "connected";
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-3 p-3 border border-border bg-muted/20 relative group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-muted-foreground">
                            {t("hosts.tunnelLabel", { number: i + 1 })}
                          </span>
                          <div
                            className={`size-1.5 rounded-full shrink-0 ${
                              isConnected
                                ? "bg-accent-brand shadow-[0_0_4px_rgba(251,146,60,0.4)]"
                                : tunnelStatus === "error"
                                  ? "bg-red-400"
                                  : "bg-muted-foreground/25"
                            }`}
                            title={tunnelStatus ?? "not connected"}
                          />
                          {host && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={connectingTunnel === i}
                              className={`h-6 text-[10px] px-2 ${isConnected ? "border-destructive/40 text-destructive hover:bg-destructive/10" : "border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"}`}
                              onClick={async () => {
                                setConnectingTunnel(i);
                                try {
                                  if (isConnected) {
                                    await disconnectTunnel(tunnelName);
                                    toast.success(
                                      t("hosts.tunnelDisconnected"),
                                    );
                                  } else {
                                    await connectTunnel({
                                      name: tunnelName,
                                      mode: tun.mode as any,
                                      sourceHostId: Number(host.id),
                                      tunnelIndex: i,
                                      hostName: host.name,
                                      sourceIP: host.ip,
                                      sourceSSHPort: host.sshPort ?? host.port,
                                      sourceUsername: form.username,
                                      sourcePassword:
                                        form.password || undefined,
                                      sourceAuthMethod: form.authType,
                                      sourceSSHKey: form.key || undefined,
                                      sourceKeyPassword:
                                        form.keyPassword || undefined,
                                      sourceCredentialId: form.credentialId
                                        ? Number(form.credentialId)
                                        : undefined,
                                      endpointIP: host.ip,
                                      endpointSSHPort:
                                        host.sshPort ?? host.port,
                                      endpointHost: tun.endpointHost ?? "",
                                      endpointUsername: form.username,
                                      endpointAuthMethod: form.authType,
                                      sourcePort: tun.sourcePort,
                                      endpointPort: tun.endpointPort ?? 0,
                                      bindHost: tun.bindHost ?? "127.0.0.1",
                                      maxRetries: tun.maxRetries ?? 3,
                                      retryInterval: tun.retryInterval ?? 10,
                                      autoStart: tun.autoStart ?? false,
                                      isPinned: false,
                                    });
                                    toast.success(t("hosts.tunnelConnecting"));
                                  }
                                } catch {
                                  toast.error(
                                    isConnected
                                      ? t("hosts.failedToDisconnectTunnel")
                                      : t("hosts.failedToConnectTunnel"),
                                  );
                                } finally {
                                  setConnectingTunnel(null);
                                }
                              }}
                            >
                              {connectingTunnel === i
                                ? "..."
                                : isConnected
                                  ? t("hosts.disconnectBtn")
                                  : t("hosts.connectBtn")}
                            </Button>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-destructive"
                          onClick={() =>
                            setField(
                              "serverTunnels",
                              form.serverTunnels.filter((_, idx) => idx !== i),
                            )
                          }
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground">
                          {t("hosts.tunnelType")}
                        </label>
                        <div className="flex gap-2">
                          {(["remote", "local", "dynamic"] as const).map(
                            (m) => (
                              <button
                                key={m}
                                onClick={() => {
                                  const updated = [...form.serverTunnels];
                                  updated[i] = { ...updated[i], mode: m };
                                  setField("serverTunnels", updated);
                                }}
                                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${tun.mode === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                              >
                                {m}
                              </button>
                            ),
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {tun.mode === "local"
                            ? t("hosts.tunnelModeLocalDesc")
                            : tun.mode === "remote"
                              ? t("hosts.tunnelModeRemoteDesc")
                              : t("hosts.tunnelModeDynamicDesc")}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {tun.mode !== "dynamic" && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-muted-foreground">
                              {t("hosts.endpointHost")}
                            </label>
                            <select
                              className="h-7 text-xs border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                              value={tun.endpointHost ?? ""}
                              onChange={(e) => {
                                const updated = [...form.serverTunnels];
                                updated[i] = {
                                  ...updated[i],
                                  endpointHost: e.target.value,
                                };
                                setField("serverTunnels", updated);
                              }}
                            >
                              <option value="">
                                {t("hosts.selectAServer")}
                              </option>
                              <option value="127.0.0.1">
                                127.0.0.1 (localhost)
                              </option>
                              {hosts
                                .filter((h) => h.enableSsh)
                                .map((h) => (
                                  <option key={h.id} value={h.ip}>
                                    {h.name || h.ip} ({h.ip})
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                        {tun.mode !== "dynamic" && (
                          <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-muted-foreground">
                              {t("hosts.endpointPort")}
                            </label>
                            <Input
                              className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              type="number"
                              value={tun.endpointPort}
                              onChange={(e) => {
                                const updated = [...form.serverTunnels];
                                updated[i] = {
                                  ...updated[i],
                                  endpointPort: Number(e.target.value),
                                };
                                setField("serverTunnels", updated);
                              }}
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.bindHost")}
                          </label>
                          <Input
                            className="h-7 text-xs"
                            placeholder="127.0.0.1"
                            value={tun.bindHost ?? ""}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                bindHost: e.target.value,
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.sourcePort")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.sourcePort}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                sourcePort: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.maxRetries")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.maxRetries}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                maxRetries: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-muted-foreground">
                            {t("hosts.retryIntervalS")}
                          </label>
                          <Input
                            className="h-7 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            value={tun.retryInterval}
                            onChange={(e) => {
                              const updated = [...form.serverTunnels];
                              updated[i] = {
                                ...updated[i],
                                retryInterval: Number(e.target.value),
                              };
                              setField("serverTunnels", updated);
                            }}
                          />
                        </div>
                      </div>
                      <SettingRow
                        label={t("hosts.autoStartLabel")}
                        description={t("hosts.autoStartDesc")}
                      >
                        <FakeSwitch
                          checked={tun.autoStart}
                          onChange={(v) => {
                            const updated = [...form.serverTunnels];
                            updated[i] = { ...updated[i], autoStart: v };
                            setField("serverTunnels", updated);
                          }}
                        />
                      </SettingRow>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "docker" && (
          <SectionCard
            title={t("hosts.dockerIntegration")}
            icon={<Box className="size-3.5" />}
          >
            <div className="flex flex-col gap-4 py-3">
              <SettingRow
                label={t("hosts.enableDockerMonitor")}
                description={t("hosts.enableDockerMonitorDesc")}
              >
                <FakeSwitch
                  checked={form.enableDocker}
                  onChange={(v) => setField("enableDocker", v)}
                />
              </SettingRow>
            </div>
          </SectionCard>
        )}

        {activeTab === "files" && (
          <SectionCard
            title={t("hosts.fileManager")}
            icon={<FolderSearch className="size-3.5" />}
          >
            <div className="flex flex-col gap-4 py-3">
              <SettingRow
                label={t("hosts.enableFileManagerMonitor")}
                description={t("hosts.enableFileManagerMonitorDesc")}
              >
                <FakeSwitch
                  checked={form.enableFileManager}
                  onChange={(v) => setField("enableFileManager", v)}
                />
              </SettingRow>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.defaultPathLabel")}
                </label>
                <Input
                  placeholder="/"
                  value={form.defaultPath}
                  onChange={(e) => setField("defaultPath", e.target.value)}
                />
                <span className="text-[10px] text-muted-foreground">
                  {t("hosts.fileManagerPathHint")}
                </span>
              </div>
            </div>
          </SectionCard>
        )}

        {activeTab === "stats" && (
          <>
            <SectionCard
              title={t("hosts.statusChecksLabel")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.enableStatusChecks")}
                  description={t("hosts.enableStatusChecksDesc")}
                >
                  <FakeSwitch
                    checked={form.statsConfig.statusCheckEnabled}
                    onChange={(v) =>
                      setField("statsConfig", {
                        ...form.statsConfig,
                        statusCheckEnabled: v,
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.useGlobalInterval")}
                  description={t("hosts.useGlobalIntervalDesc")}
                >
                  <FakeSwitch
                    checked={form.statsConfig.useGlobalStatusInterval}
                    onChange={(v) =>
                      setField("statsConfig", {
                        ...form.statsConfig,
                        useGlobalStatusInterval: v,
                      })
                    }
                  />
                </SettingRow>
                {form.statsConfig.statusCheckEnabled &&
                  !form.statsConfig.useGlobalStatusInterval && (
                    <SettingRow
                      label={t("hosts.checkIntervalS")}
                      description={t("hosts.checkIntervalDesc")}
                    >
                      <Input
                        type="number"
                        value={form.statsConfig.statusCheckInterval}
                        onChange={(e) =>
                          setField("statsConfig", {
                            ...form.statsConfig,
                            statusCheckInterval: Number(e.target.value),
                          })
                        }
                        className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </SettingRow>
                  )}
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.metricsCollectionLabel")}
              icon={<Server className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.enableMetricsLabel")}
                  description={t("hosts.enableMetricsDesc")}
                >
                  <FakeSwitch
                    checked={form.statsConfig.metricsEnabled}
                    onChange={(v) =>
                      setField("statsConfig", {
                        ...form.statsConfig,
                        metricsEnabled: v,
                      })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.useGlobalMetrics")}
                  description={t("hosts.useGlobalMetricsDesc")}
                >
                  <FakeSwitch
                    checked={form.statsConfig.useGlobalMetricsInterval}
                    onChange={(v) =>
                      setField("statsConfig", {
                        ...form.statsConfig,
                        useGlobalMetricsInterval: v,
                      })
                    }
                  />
                </SettingRow>
                {form.statsConfig.metricsEnabled &&
                  !form.statsConfig.useGlobalMetricsInterval && (
                    <SettingRow
                      label={t("hosts.metricsIntervalS")}
                      description={t("hosts.metricsIntervalDesc2")}
                    >
                      <Input
                        type="number"
                        value={form.statsConfig.metricsInterval}
                        onChange={(e) =>
                          setField("statsConfig", {
                            ...form.statsConfig,
                            metricsInterval: Number(e.target.value),
                          })
                        }
                        className="w-20 h-7 text-xs text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </SettingRow>
                  )}
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.visibleWidgets")}
              icon={<LayoutDashboard className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                {[
                  {
                    id: "cpu",
                    label: t("hosts.cpuUsageLabel"),
                    desc: t("hosts.cpuUsageDesc"),
                  },
                  {
                    id: "memory",
                    label: t("hosts.memoryLabel"),
                    desc: t("hosts.memoryDesc"),
                  },
                  {
                    id: "disk",
                    label: t("hosts.storageLabel"),
                    desc: t("hosts.storageDesc"),
                  },
                  {
                    id: "network",
                    label: t("hosts.networkLabel"),
                    desc: t("hosts.networkDesc"),
                  },
                  {
                    id: "uptime",
                    label: t("hosts.uptimeLabel"),
                    desc: t("hosts.uptimeDesc"),
                  },
                  {
                    id: "system",
                    label: t("hosts.systemInfoLabel"),
                    desc: t("hosts.systemInfoDesc"),
                  },
                  {
                    id: "login_stats",
                    label: t("hosts.recentLoginsLabel"),
                    desc: t("hosts.recentLoginsDesc"),
                  },
                  {
                    id: "processes",
                    label: t("hosts.topProcessesLabel"),
                    desc: t("hosts.topProcessesDesc"),
                  },
                  {
                    id: "ports",
                    label: t("hosts.listeningPortsLabel"),
                    desc: t("hosts.listeningPortsDesc"),
                  },
                  {
                    id: "firewall",
                    label: t("hosts.firewallLabel"),
                    desc: t("hosts.firewallDesc"),
                  },
                ].map((w) => (
                  <SettingRow key={w.id} label={w.label} description={w.desc}>
                    <FakeSwitch
                      checked={form.statsConfig.enabledWidgets.includes(w.id)}
                      onChange={(v) => {
                        const widgets = v
                          ? [...form.statsConfig.enabledWidgets, w.id]
                          : form.statsConfig.enabledWidgets.filter(
                              (x) => x !== w.id,
                            );
                        setField("statsConfig", {
                          ...form.statsConfig,
                          enabledWidgets: widgets,
                        });
                      }}
                    />
                  </SettingRow>
                ))}
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.quickActionsLabel")}
              icon={<Zap className="size-3.5" />}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                  onClick={() =>
                    setField("quickActions", [
                      ...form.quickActions,
                      { name: "", snippetId: "" },
                    ])
                  }
                >
                  <Plus className="size-3 mr-1" /> {t("hosts.addActionBtn")}
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-3">
                <p className="text-xs text-muted-foreground">
                  {t("hosts.quickActionsToolbar")}
                </p>
                {form.quickActions.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-4 text-muted-foreground/40 gap-1.5">
                    <Zap className="size-6" />
                    <span className="text-xs">{t("hosts.noQuickActions")}</span>
                  </div>
                )}
                {form.quickActions.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 p-2 bg-muted/20 border border-border group"
                  >
                    <Input
                      className="h-7 text-xs flex-1"
                      placeholder={t("hosts.buttonLabel")}
                      value={a.name}
                      onChange={(e) => {
                        const updated = [...form.quickActions];
                        updated[i] = { ...updated[i], name: e.target.value };
                        setField("quickActions", updated);
                      }}
                    />
                    <select
                      className="h-7 text-xs flex-1 border border-border bg-background px-2 outline-none focus:ring-1 focus:ring-ring"
                      value={a.snippetId}
                      onChange={(e) => {
                        const updated = [...form.quickActions];
                        updated[i] = {
                          ...updated[i],
                          snippetId: e.target.value,
                        };
                        setField("quickActions", updated);
                      }}
                    >
                      <option value="">
                        {t("hosts.selectSnippetPlaceholder")}
                      </option>
                      {snippets.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() =>
                        setField(
                          "quickActions",
                          form.quickActions.filter((_, idx) => idx !== i),
                        )
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "rdp" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.rdpPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="3389"
                    value={form.rdpPort}
                    onChange={(e) =>
                      setField("rdpPort", Number(e.target.value) as any)
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.username")}
                  </label>
                  <Input
                    placeholder="Administrator"
                    value={form.rdpUser}
                    onChange={(e) => setField("rdpUser", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.password")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.rdpPassword}
                    onChange={(e) => setField("rdpPassword", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.domain")}
                  </label>
                  <Input
                    placeholder="WORKGROUP"
                    value={form.domain}
                    onChange={(e) => setField("domain", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.connectionSettings")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.securityMode")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.security ?? "any"}
                    onChange={(e) => setField("security", e.target.value)}
                  >
                    <option value="any">Any</option>
                    <option value="nla">NLA</option>
                    <option value="nla-ext">NLA Extended</option>
                    <option value="tls">TLS</option>
                    <option value="vmconnect">VMConnect</option>
                    <option value="rdp">RDP</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.ignoreCertificate")}
                  description={t("hosts.guac.ignoreCertificateDesc")}
                >
                  <FakeSwitch
                    checked={form.ignoreCert}
                    onChange={(v) => setField("ignoreCert", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorDepth")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-depth"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-depth", e.target.value)
                    }
                  >
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
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.dpi")}
                  </label>
                  <Input
                    type="number"
                    placeholder="96"
                    value={form.guacamoleConfig["dpi"] ?? ""}
                    onChange={(e) => setGuacField("dpi", e.target.value)}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.resizeMethod")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["resize-method"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("resize-method", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.forceLossless")}
                  description={t("hosts.guac.forceLosslessDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["force-lossless"]}
                    onChange={(v) => setGuacField("force-lossless", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.audioSettings")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.disableAudio")}
                  description={t("hosts.guac.disableAudioDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-audio"]}
                    onChange={(v) => setGuacField("disable-audio", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableAudioInput")}
                  description={t("hosts.guac.enableAudioInputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-audio-input"]}
                    onChange={(v) => setGuacField("enable-audio-input", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.rdpPerformance")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.wallpaper")}
                  description={t("hosts.guac.wallpaperDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-wallpaper"]}
                    onChange={(v) => setGuacField("enable-wallpaper", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.theming")}
                  description={t("hosts.guac.themingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-theming"]}
                    onChange={(v) => setGuacField("enable-theming", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.fontSmoothing")}
                  description={t("hosts.guac.fontSmoothingDesc")}
                >
                  <FakeSwitch
                    checked={
                      form.guacamoleConfig["enable-font-smoothing"] !== false
                    }
                    onChange={(v) => setGuacField("enable-font-smoothing", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.fullWindowDrag")}
                  description={t("hosts.guac.fullWindowDragDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-full-window-drag"]}
                    onChange={(v) => setGuacField("enable-full-window-drag", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.desktopComposition")}
                  description={t("hosts.guac.desktopCompositionDesc")}
                >
                  <FakeSwitch
                    checked={
                      !!form.guacamoleConfig["enable-desktop-composition"]
                    }
                    onChange={(v) =>
                      setGuacField("enable-desktop-composition", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.menuAnimations")}
                  description={t("hosts.guac.menuAnimationsDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-menu-animations"]}
                    onChange={(v) => setGuacField("enable-menu-animations", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableBitmapCaching")}
                  description={t("hosts.guac.disableBitmapCachingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-bitmap-caching"]}
                    onChange={(v) => setGuacField("disable-bitmap-caching", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableOffscreenCaching")}
                  description={t("hosts.guac.disableOffscreenCachingDesc")}
                >
                  <FakeSwitch
                    checked={
                      !!form.guacamoleConfig["disable-offscreen-caching"]
                    }
                    onChange={(v) =>
                      setGuacField("disable-offscreen-caching", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableGlyphCaching")}
                  description={t("hosts.guac.disableGlyphCachingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-glyph-caching"]}
                    onChange={(v) => setGuacField("disable-glyph-caching", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableGfx")}
                  description={t("hosts.guac.enableGfxDesc")}
                >
                  <FakeSwitch
                    checked={form.guacamoleConfig["enable-gfx"] !== false}
                    onChange={(v) => setGuacField("enable-gfx", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.deviceRedirection")}
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.enablePrinting")}
                  description={t("hosts.guac.enablePrintingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-printing"]}
                    onChange={(v) => setGuacField("enable-printing", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableDriveRedirection")}
                  description={t("hosts.guac.enableDriveRedirectionDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-drive"]}
                    onChange={(v) => setGuacField("enable-drive", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.driveName")}
                    </label>
                    <Input
                      placeholder="Termix Drive"
                      value={form.guacamoleConfig["drive-name"] ?? ""}
                      onChange={(e) =>
                        setGuacField("drive-name", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.drivePath")}
                    </label>
                    <Input
                      placeholder="/home/user/shared"
                      value={form.guacamoleConfig["drive-path"] ?? ""}
                      onChange={(e) =>
                        setGuacField("drive-path", e.target.value)
                      }
                    />
                  </div>
                </div>
                <SettingRow
                  label={t("hosts.guac.createDrivePath")}
                  description={t("hosts.guac.createDrivePathDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-drive-path"]}
                    onChange={(v) => setGuacField("create-drive-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableDownload")}
                  description={t("hosts.guac.disableDownloadDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-download"]}
                    onChange={(v) => setGuacField("disable-download", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disableUpload")}
                  description={t("hosts.guac.disableUploadDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-upload"]}
                    onChange={(v) => setGuacField("disable-upload", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.enableTouch")}
                  description={t("hosts.guac.enableTouchDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["enable-touch"]}
                    onChange={(v) => setGuacField("enable-touch", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.session")}
              icon={<Server className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.clientName")}
                  </label>
                  <Input
                    placeholder="Termix"
                    value={form.guacamoleConfig["client-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("client-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.consoleSession")}
                  description={t("hosts.guac.consoleSessionDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["console"]}
                    onChange={(v) => setGuacField("console", v)}
                  />
                </SettingRow>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.initialProgram")}
                  </label>
                  <Input
                    placeholder="e.g. cmd.exe"
                    value={form.guacamoleConfig["initial-program"] ?? ""}
                    onChange={(e) =>
                      setGuacField("initial-program", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.serverLayout")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["server-layout"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("server-layout", e.target.value)
                    }
                  >
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
                    {t("hosts.guac.timezone")}
                  </label>
                  <Input
                    placeholder="e.g. America/New_York"
                    value={form.guacamoleConfig["timezone"] ?? ""}
                    onChange={(e) => setGuacField("timezone", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.gateway")}
              icon={<Network className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayHostname")}
                    </label>
                    <Input
                      placeholder="gateway.example.com"
                      value={form.guacamoleConfig["gateway-hostname"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-hostname", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="443"
                      value={form.guacamoleConfig["gateway-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayUsername")}
                    </label>
                    <Input
                      placeholder="user"
                      value={form.guacamoleConfig["gateway-username"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-username", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayPassword")}
                    </label>
                    <PasswordInput
                      className="h-8 text-xs pr-8"
                      placeholder="••••••••"
                      value={form.guacamoleConfig["gateway-password"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-password", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.gatewayDomain")}
                    </label>
                    <Input
                      placeholder="DOMAIN"
                      value={form.guacamoleConfig["gateway-domain"] ?? ""}
                      onChange={(e) =>
                        setGuacField("gateway-domain", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.remoteApp")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.remoteAppProgram")}
                  </label>
                  <Input
                    placeholder="||MyApp"
                    value={form.guacamoleConfig["remote-app"] ?? ""}
                    onChange={(e) => setGuacField("remote-app", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.workingDirectory")}
                  </label>
                  <Input
                    placeholder="C:\Apps\MyApp"
                    value={form.guacamoleConfig["remote-app-dir"] ?? ""}
                    onChange={(e) =>
                      setGuacField("remote-app-dir", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.arguments")}
                  </label>
                  <Input
                    placeholder="--flag value"
                    value={form.guacamoleConfig["remote-app-args"] ?? ""}
                    onChange={(e) =>
                      setGuacField("remote-app-args", e.target.value)
                    }
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.clipboard")}
              icon={<Copy className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.normalizeLineEndings")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={
                      form.guacamoleConfig["normalize-clipboard"] ?? "auto"
                    }
                    onChange={(e) =>
                      setGuacField("normalize-clipboard", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.disableCopy")}
                  description={t("hosts.guac.disableCopyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-copy"]}
                    onChange={(v) => setGuacField("disable-copy", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disablePaste")}
                  description={t("hosts.guac.disablePasteDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-paste"]}
                    onChange={(v) => setGuacField("disable-paste", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeMouse")}
                  description={t("hosts.guac.excludeMouseDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
                    onChange={(v) => setGuacField("recording-exclude-mouse", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.wakeOnLan")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.sendWolPacket")}
                  description={t("hosts.guac.sendWolPacketDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["wol-send-packet"]}
                    onChange={(v) => setGuacField("wol-send-packet", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.macAddress")}
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      value={
                        form.guacamoleConfig["wol-mac-addr"] ??
                        host?.macAddress ??
                        ""
                      }
                      onChange={(e) =>
                        setGuacField("wol-mac-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.broadcastAddress")}
                    </label>
                    <Input
                      placeholder="255.255.255.255"
                      value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-broadcast-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.udpPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="9"
                      value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-udp-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.waitTimeS")}
                    </label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-wait-time", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "vnc" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="5900"
                    value={form.vncPort}
                    onChange={(e) =>
                      setField("vncPort", Number(e.target.value) as any)
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncPassword")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.vncPassword}
                    onChange={(e) => setField("vncPassword", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.vncUsernameOptional")}
                  </label>
                  <Input
                    placeholder={t("hosts.guac.vncLeaveBlank")}
                    value={form.vncUser}
                    onChange={(e) => setField("vncUser", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorDepth")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-depth"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-depth", e.target.value)
                    }
                  >
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
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.resizeMethod")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["resize-method"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("resize-method", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="display-update">Display Update</option>
                    <option value="reconnect">Reconnect</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.forceLossless")}
                  description={t("hosts.guac.forceLosslessDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["force-lossless"]}
                    onChange={(v) => setGuacField("force-lossless", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.audioSettings")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-0 py-1">
                <SettingRow
                  label={t("hosts.guac.disableAudio")}
                  description={t("hosts.guac.disableAudioDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-audio"]}
                    onChange={(v) => setGuacField("disable-audio", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.vncSettings")}
              icon={<Settings className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.cursorMode")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["cursor"] ?? "auto"}
                    onChange={(e) => setGuacField("cursor", e.target.value)}
                  >
                    <option value="auto">Auto</option>
                    <option value="local">Local</option>
                    <option value="remote">Remote</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.swapRedBlue")}
                  description={t("hosts.guac.swapRedBlueDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["swap-red-blue"]}
                    onChange={(v) => setGuacField("swap-red-blue", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.readOnly")}
                  description={t("hosts.guac.readOnlyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["read-only"]}
                    onChange={(v) => setGuacField("read-only", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.clipboard")}
              icon={<Copy className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.normalizeLineEndings")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={
                      form.guacamoleConfig["normalize-clipboard"] ?? "auto"
                    }
                    onChange={(e) =>
                      setGuacField("normalize-clipboard", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="preserve">Preserve</option>
                    <option value="unix">Unix (LF)</option>
                    <option value="windows">Windows (CRLF)</option>
                  </select>
                </div>
                <SettingRow
                  label={t("hosts.guac.disableCopy")}
                  description={t("hosts.guac.disableCopyDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-copy"]}
                    onChange={(v) => setGuacField("disable-copy", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.disablePaste")}
                  description={t("hosts.guac.disablePasteDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["disable-paste"]}
                    onChange={(v) => setGuacField("disable-paste", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeMouse")}
                  description={t("hosts.guac.excludeMouseDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-mouse"]}
                    onChange={(v) => setGuacField("recording-exclude-mouse", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.wakeOnLan")}
              icon={<Zap className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <SettingRow
                  label={t("hosts.guac.sendWolPacket")}
                  description={t("hosts.guac.sendWolPacketDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["wol-send-packet"]}
                    onChange={(v) => setGuacField("wol-send-packet", v)}
                  />
                </SettingRow>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.macAddress")}
                    </label>
                    <Input
                      placeholder="AA:BB:CC:DD:EE:FF"
                      value={
                        form.guacamoleConfig["wol-mac-addr"] ??
                        host?.macAddress ??
                        ""
                      }
                      onChange={(e) =>
                        setGuacField("wol-mac-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.broadcastAddress")}
                    </label>
                    <Input
                      placeholder="255.255.255.255"
                      value={form.guacamoleConfig["wol-broadcast-addr"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-broadcast-addr", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.udpPort")}
                    </label>
                    <Input
                      type="number"
                      placeholder="9"
                      value={form.guacamoleConfig["wol-udp-port"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-udp-port", e.target.value)
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.waitTimeS")}
                    </label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.guacamoleConfig["wol-wait-time"] ?? ""}
                      onChange={(e) =>
                        setGuacField("wol-wait-time", e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}

        {activeTab === "telnet" && (
          <>
            <SectionCard
              title={t("hosts.guac.connection")}
              icon={<Globe className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.telnetPort")}
                  </label>
                  <Input
                    type="number"
                    placeholder="23"
                    value={form.telnetPort}
                    onChange={(e) =>
                      setField("telnetPort", Number(e.target.value) as any)
                    }
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </SectionCard>
            <SectionCard
              title={t("hosts.guac.authentication")}
              icon={<Shield className="size-3.5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.username")}
                  </label>
                  <Input
                    placeholder="admin"
                    value={form.telnetUser}
                    onChange={(e) => setField("telnetUser", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.password")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder="••••••••"
                    value={form.telnetPassword}
                    onChange={(e) => setField("telnetPassword", e.target.value)}
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.displaySettings")}
              icon={<Monitor className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.width")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["width"] ?? ""}
                      onChange={(e) => setGuacField("width", e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.guac.height")}
                    </label>
                    <Input
                      type="number"
                      placeholder="Auto"
                      value={form.guacamoleConfig["height"] ?? ""}
                      onChange={(e) => setGuacField("height", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.terminalSettings")}
              icon={<Terminal className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.terminalType")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["terminal-type"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("terminal-type", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="xterm">xterm</option>
                    <option value="xterm-256color">xterm-256color</option>
                    <option value="vt100">VT100</option>
                    <option value="vt220">VT220</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.fontName")}
                  </label>
                  <Input
                    placeholder="monospace"
                    value={form.guacamoleConfig["font-name"] ?? ""}
                    onChange={(e) => setGuacField("font-name", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.fontSize")}
                  </label>
                  <Input
                    type="number"
                    value={form.guacamoleConfig["font-size"] ?? 12}
                    onChange={(e) =>
                      setGuacField("font-size", Number(e.target.value))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.colorScheme")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["color-scheme"] ?? "auto"}
                    onChange={(e) =>
                      setGuacField("color-scheme", e.target.value)
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="black-white">Black on White</option>
                    <option value="white-black">White on Black</option>
                    <option value="gray-black">Gray on Black</option>
                    <option value="green-black">Green on Black</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.backspaceKey")}
                  </label>
                  <select
                    className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                    value={form.guacamoleConfig["backspace"] ?? "auto"}
                    onChange={(e) => setGuacField("backspace", e.target.value)}
                  >
                    <option value="auto">Auto</option>
                    <option value="127">DEL (127)</option>
                    <option value="8">BS (8)</option>
                  </select>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title={t("hosts.guac.sessionRecording")}
              icon={<Activity className="size-3.5" />}
            >
              <div className="flex flex-col gap-4 py-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingPath")}
                  </label>
                  <Input
                    placeholder="/var/lib/termix/recordings"
                    value={form.guacamoleConfig["recording-path"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-path", e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.guac.recordingName")}
                  </label>
                  <Input
                    placeholder="${GUAC_USERNAME}-${GUAC_DATE}-${GUAC_TIME}"
                    value={form.guacamoleConfig["recording-name"] ?? ""}
                    onChange={(e) =>
                      setGuacField("recording-name", e.target.value)
                    }
                  />
                </div>
                <SettingRow
                  label={t("hosts.guac.createPathIfMissing")}
                  description={t("hosts.guac.createPathIfMissingDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["create-recording-path"]}
                    onChange={(v) => setGuacField("create-recording-path", v)}
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.excludeOutput")}
                  description={t("hosts.guac.excludeOutputDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-exclude-output"]}
                    onChange={(v) =>
                      setGuacField("recording-exclude-output", v)
                    }
                  />
                </SettingRow>
                <SettingRow
                  label={t("hosts.guac.includeKeystrokes")}
                  description={t("hosts.guac.includeKeystrokesDesc")}
                >
                  <FakeSwitch
                    checked={!!form.guacamoleConfig["recording-include-keys"]}
                    onChange={(v) => setGuacField("recording-include-keys", v)}
                  />
                </SettingRow>
              </div>
            </SectionCard>
          </>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-3 mb-6">
        <Button
          variant="ghost"
          onClick={() => {
            setPreviewTerminalTheme(null);
            onBack();
          }}
          disabled={saving}
        >
          {t("hosts.guac.cancelBtn")}
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? t("hosts.guac.savingBtn")
            : host
              ? t("hosts.guac.updateHostBtn")
              : t("hosts.guac.addHostBtn")}
        </Button>
      </div>
    </div>
  );
}

function CredentialEditorView({
  credential,
  activeTab,
  onBack,
  onSave,
}: {
  credential: Credential | null;
  activeTab: string;
  onBack: () => void;
  onSave: (saved: any) => void;
}) {
  const [credForm, setCredForm] = useState(() => ({
    name: credential?.name ?? "",
    username: credential?.username ?? "",
    folder: credential?.folder ?? "",
    description: credential?.description ?? "",
    tags: credential?.tags ?? ([] as string[]),
    tagInput: "",
    type: credential?.type ?? "password",
    value: credential?.value ?? "",
    publicKey: credential?.publicKey ?? "",
    passphrase: credential?.passphrase ?? "",
    certPublicKey: (credential as any)?.certPublicKey ?? "",
  }));
  const { t } = useTranslation();
  const [generatingKey, setGeneratingKey] = useState(false);
  const [generatingPublicKey, setGeneratingPublicKey] = useState(false);
  const credFileInputRef = useRef<HTMLInputElement>(null);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const setCredField = <K extends keyof typeof credForm>(
    k: K,
    v: (typeof credForm)[K],
  ) => setCredForm((p) => ({ ...p, [k]: v }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = {
        name: credForm.name,
        username: credForm.username,
        folder: credForm.folder || null,
        description: credForm.description || null,
        tags: credForm.tags,
        authType: credForm.type,
        password: credForm.type === "password" ? credForm.value : null,
        key:
          credForm.type === "key"
            ? credForm.value === "existing_key"
              ? undefined
              : credForm.value || null
            : null,
        publicKey: credForm.type === "key" ? credForm.publicKey : null,
        certPublicKey:
          credForm.type === "key" ? credForm.certPublicKey || null : null,
        keyPassword:
          credForm.type === "key"
            ? credForm.passphrase === "existing_key_password"
              ? undefined
              : credForm.passphrase || null
            : null,
      };
      const saved = credential
        ? await updateCredential(Number(credential.id), data)
        : await createCredential(data);
      toast.success(
        credential
          ? t("hosts.credentialUpdated")
          : t("hosts.credentialCreated"),
      );
      onSave(saved);
    } catch {
      toast.error(t("hosts.failedToSaveCredential"));
    } finally {
      setSaving(false);
    }
  };

  const type = credForm.type;

  return (
    <div className="flex flex-col gap-3">
      {activeTab === "general" && (
        <SectionCard
          title={t("hosts.basicInformation")}
          icon={<Info className="size-3.5" />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.friendlyNameLabel")}
              </label>
              <Input
                placeholder="e.g. Production SSH Key"
                value={credForm.name}
                onChange={(e) => setCredField("name", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.folder")}
              </label>
              <Input
                placeholder="e.g. Server Keys"
                value={credForm.folder}
                onChange={(e) => setCredField("folder", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.descriptionLabel")}
              </label>
              <Input
                placeholder="Optional details..."
                value={credForm.description}
                onChange={(e) => setCredField("description", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.tags")}
              </label>
              <div className="flex flex-wrap items-center gap-1 min-h-9 px-2 py-1 border border-border bg-background focus-within:ring-1 focus-within:ring-ring">
                {credForm.tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] bg-muted border border-border/60 text-foreground"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() =>
                        setCredField(
                          "tags",
                          credForm.tags.filter((tg) => tg !== tag),
                        )
                      }
                      className="text-muted-foreground hover:text-destructive ml-0.5"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  className="flex-1 min-w-16 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                  placeholder={
                    credForm.tags.length === 0
                      ? t("hosts.addTagsPlaceholder")
                      : ""
                  }
                  value={credForm.tagInput}
                  onChange={(e) => setCredField("tagInput", e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.key === " " || e.key === "Enter") &&
                      credForm.tagInput.trim()
                    ) {
                      e.preventDefault();
                      const tag = credForm.tagInput.trim();
                      if (!credForm.tags.includes(tag))
                        setCredField("tags", [...credForm.tags, tag]);
                      setCredField("tagInput", "");
                    } else if (
                      e.key === "Backspace" &&
                      !credForm.tagInput &&
                      credForm.tags.length > 0
                    ) {
                      setCredField("tags", credForm.tags.slice(0, -1));
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {activeTab === "auth" && (
        <SectionCard
          title={t("hosts.authDetailsSection")}
          icon={<Lock className="size-3.5" />}
        >
          <div className="flex flex-col gap-4 py-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.credTypeLabel")}
              </label>
              <div className="flex gap-2">
                {["password", "key"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setCredField("type", m as any)}
                    className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest border transition-colors ${type === m ? "border-accent-brand/40 bg-accent-brand/10 text-accent-brand" : "border-border text-muted-foreground hover:text-foreground"}`}
                  >
                    {m === "key"
                      ? t("hosts.sshPrivateKey")
                      : t("hosts.password")}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.username")}
              </label>
              <Input
                placeholder="e.g. root or deploy"
                value={credForm.username}
                onChange={(e) => setCredField("username", e.target.value)}
              />
            </div>
            {type === "password" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {t("hosts.password")}
                </label>
                <PasswordInput
                  className="h-8 text-xs pr-8"
                  placeholder="••••••••"
                  value={credForm.value}
                  onChange={(e) => setCredField("value", e.target.value)}
                />
              </div>
            )}
            {type === "key" && (
              <div className="flex flex-col gap-4">
                <div className="p-3 border border-border bg-muted/20">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    {t("hosts.generateKeyPairTitle")}
                  </p>
                  <p className="text-[10px] text-muted-foreground mb-2">
                    {t("hosts.generateKeyPairDescription")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Ed25519", type: "ssh-ed25519" },
                      {
                        label: "ECDSA (nistp256)",
                        type: "ecdsa-sha2-nistp256",
                      },
                      { label: "RSA (2048)", type: "ssh-rsa", bits: 2048 },
                    ].map(({ label, type: keyType, bits }) => (
                      <Button
                        key={label}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] px-2"
                        disabled={generatingKey}
                        onClick={async () => {
                          setGeneratingKey(true);
                          try {
                            const result = await generateKeyPair(
                              keyType as
                                | "ssh-ed25519"
                                | "ssh-rsa"
                                | "ecdsa-sha2-nistp256",
                              bits,
                              credForm.passphrase === "existing_key_password"
                                ? undefined
                                : credForm.passphrase || undefined,
                            );
                            if (result.success) {
                              setCredField("value", result.privateKey);
                              setCredField("publicKey", result.publicKey);
                              toast.success(
                                t("hosts.keyPairGenerated", { label }),
                              );
                            } else {
                              toast.error(
                                result.error ??
                                  t("hosts.failedToGenerateKeyPair"),
                              );
                            }
                          } catch {
                            toast.error(t("hosts.failedToGenerateKeyPair"));
                          } finally {
                            setGeneratingKey(false);
                          }
                        }}
                      >
                        {generatingKey
                          ? t("hosts.generatingKey")
                          : t("hosts.generateLabel", { label })}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.sshPrivateKey")}
                    </label>
                    <button
                      type="button"
                      className="text-[10px] text-accent-brand hover:text-accent-brand/80 flex items-center gap-1"
                      onClick={() => credFileInputRef.current?.click()}
                    >
                      <Upload className="size-3" /> {t("hosts.uploadFileBtn")}
                    </button>
                  </div>
                  <input
                    ref={credFileInputRef}
                    type="file"
                    accept=".pem,.key,.txt,.ppk"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      setCredField("value", text.trim());
                      e.target.value = "";
                    }}
                  />
                  {credForm.value === "existing_key" && (
                    <div className="px-3 py-2 text-[10px] border border-accent-brand/30 bg-accent-brand/5 text-accent-brand">
                      {t("hosts.keySaved")} — {t("hosts.keyReplaceNotice")}
                    </div>
                  )}
                  <textarea
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={8}
                    value={
                      credForm.value === "existing_key" ? "" : credForm.value
                    }
                    onChange={(e) => setCredField("value", e.target.value)}
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {t("hosts.keyPassphraseOptional")}
                  </label>
                  <PasswordInput
                    className="h-8 text-xs pr-8"
                    placeholder={
                      credForm.passphrase === "existing_key_password"
                        ? t("hosts.keyPassphraseSaved")
                        : "••••••••"
                    }
                    value={
                      credForm.passphrase === "existing_key_password"
                        ? ""
                        : credForm.passphrase
                    }
                    onFocus={() => {
                      if (credForm.passphrase === "existing_key_password")
                        setCredField("passphrase", "");
                    }}
                    onChange={(e) => setCredField("passphrase", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("hosts.sshPublicKeyOptional")}
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2 border-accent-brand/40 text-accent-brand"
                      disabled={
                        !credForm.value ||
                        credForm.value === "existing_key" ||
                        generatingPublicKey
                      }
                      onClick={async () => {
                        setGeneratingPublicKey(true);
                        try {
                          const result = await generatePublicKeyFromPrivate(
                            credForm.value,
                            credForm.passphrase === "existing_key_password"
                              ? undefined
                              : credForm.passphrase || undefined,
                          );
                          if (result?.publicKey) {
                            setCredField("publicKey", result.publicKey);
                            toast.success(t("hosts.publicKeyGenerated"));
                          } else {
                            toast.error(t("hosts.failedToGeneratePublicKey"));
                          }
                        } catch {
                          toast.error(t("hosts.failedToGeneratePublicKey"));
                        } finally {
                          setGeneratingPublicKey(false);
                        }
                      }}
                    >
                      {generatingPublicKey
                        ? t("hosts.generatingKey")
                        : t("hosts.generateFromPrivateKey")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      disabled={!credForm.publicKey}
                      onClick={() => {
                        navigator.clipboard.writeText(credForm.publicKey ?? "");
                        toast.success(t("hosts.publicKeyCopied"));
                      }}
                    >
                      <Copy className="size-3 mr-1" /> {t("common.copy")}
                    </Button>
                  </div>
                  <textarea
                    placeholder="ssh-rsa AAAAB3Nza..."
                    rows={3}
                    value={credForm.publicKey}
                    onChange={(e) => setCredField("publicKey", e.target.value)}
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
                <div className="flex flex-col gap-1.5 p-3 border border-border bg-muted/20">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {t("credentials.caCertificate")}
                    </label>
                    {credForm.certPublicKey && (
                      <button
                        type="button"
                        className="text-[10px] text-destructive hover:text-destructive/80"
                        onClick={() => setCredField("certPublicKey", "")}
                      >
                        {t("credentials.clearCert")}
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t("credentials.caCertificateDescription")}
                  </p>
                  <button
                    type="button"
                    className="text-[10px] text-accent-brand hover:text-accent-brand/80 flex items-center gap-1 self-start"
                    onClick={() => certFileInputRef.current?.click()}
                  >
                    <Upload className="size-3" />{" "}
                    {t("credentials.uploadCertFile")}
                  </button>
                  <input
                    ref={certFileInputRef}
                    type="file"
                    accept=".pub,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      setCredField("certPublicKey", text.trim());
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    placeholder={t("credentials.pasteOrUploadCert")}
                    rows={2}
                    value={credForm.certPublicKey}
                    onChange={(e) =>
                      setCredField("certPublicKey", e.target.value)
                    }
                    className="w-full px-3 py-2 text-[10px] bg-background border border-border text-foreground placeholder:text-muted-foreground resize-none outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <div className="flex justify-end gap-3 mt-3">
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          {t("hosts.cancelBtn")}
        </Button>
        <Button
          variant="outline"
          className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10 hover:text-accent-brand px-8"
          onClick={handleSave}
          disabled={saving}
        >
          {saving
            ? t("hosts.savingBtn")
            : credential
              ? t("hosts.updateCredentialBtn")
              : t("hosts.addCredentialBtn")}
        </Button>
      </div>
    </div>
  );
}

export function HostManager({
  pendingEditId,
  pendingAction,
  onEditingChange,
  hideListHeader,
  externalSearch,
  active = true,
}: {
  pendingEditId?: MutableRefObject<string | null>;
  pendingAction?: MutableRefObject<"add-host" | "add-credential" | null>;
  onEditingChange?: (editing: boolean) => void;
  hideListHeader?: boolean;
  externalSearch?: string;
  active?: boolean;
} = {}) {
  const { t } = useTranslation();
  const [editingHost, setEditingHost] = useState<Host | "new" | null>(null);
  const [editingCredential, setEditingCredential] = useState<
    Credential | "new" | null
  >(null);
  const [activeHostTab, setActiveHostTab] = useState("general");
  const [activeCredentialTab, setActiveCredentialTab] = useState("general");
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveSearch = externalSearch ?? searchQuery;
  const [hosts, setHosts] = useState<Host[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [deployDialog, setDeployDialog] = useState<{
    cred: Credential;
    hostId: string;
  } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [editingProtocols, setEditingProtocols] = useState({
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
  });
  const [editingHostCredentialId, setEditingHostCredentialId] = useState("");
  const hostsRef = useRef<Host[]>([]);
  useEffect(() => {
    hostsRef.current = hosts;
  }, [hosts]);
  const [editingCredFolderName, setEditingCredFolderName] = useState<
    string | null
  >(null);
  const [editingCredFolderValue, setEditingCredFolderValue] = useState("");

  const applyPendingEdit = (hostList: Host[]) => {
    if (pendingEditId?.current) {
      const id = pendingEditId.current;
      pendingEditId.current = null;
      const host = hostList.find((h) => h.id === id);
      if (host) {
        setEditingHost(host);
        setEditingCredential(null);
        setActiveHostTab("general");
        setEditingProtocols({
          enableSsh: host.enableSsh,
          enableRdp: host.enableRdp,
          enableVnc: host.enableVnc,
          enableTelnet: host.enableTelnet,
        });
        setEditingHostCredentialId(host.credentialId ?? "");
        return true;
      }
    }
    return false;
  };

  useEffect(() => {
    getSSHHosts()
      .then((raw) => {
        const converted = raw.map(sshHostToHost);
        setHosts(converted);
        applyPendingEdit(converted);
      })
      .catch(() => {});
    getCredentials()
      .then((res: any) => {
        const arr = Array.isArray(res) ? res : [];
        setCredentials(
          arr.map((c: any) => ({
            id: String(c.id),
            name: c.name,
            username: c.username,
            type: c.authType === "key" ? "key" : "password",
            description: c.description ?? "",
            folder: c.folder ?? "",
            tags: c.tags ?? [],
            publicKey: c.publicKey ?? undefined,
          })),
        );
      })
      .catch(() => {})
      .finally(() => setCredentialsLoading(false));
  }, []);

  useEffect(() => {
    if (pendingAction?.current) {
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action === "add-host") {
        setEditingHost("new");
        setEditingCredential(null);
        setEditingProtocols({
          enableSsh: true,
          enableRdp: false,
          enableVnc: false,
          enableTelnet: false,
        });
        setEditingHostCredentialId("");
        setActiveHostTab("general");
      } else if (action === "add-credential") {
        setEditingCredential("new");
        setEditingHost(null);
      }
    }
  }, [pendingEditId, pendingAction]);

  useEffect(() => {
    if (!active) return;
    const handleAddHost = () => {
      setEditingHost("new");
      setEditingCredential(null);
      setEditingProtocols({
        enableSsh: true,
        enableRdp: false,
        enableVnc: false,
        enableTelnet: false,
      });
      setEditingHostCredentialId("");
      setActiveHostTab("general");
    };
    const handleAddCredential = () => {
      setEditingCredential("new");
      setEditingHost(null);
    };
    const handleEditHost = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const host = hostsRef.current.find((h) => h.id === id);
      if (host) {
        setEditingHost(host);
        setEditingCredential(null);
        setActiveHostTab("general");
        setEditingProtocols({
          enableSsh: host.enableSsh,
          enableRdp: host.enableRdp,
          enableVnc: host.enableVnc,
          enableTelnet: host.enableTelnet,
        });
        setEditingHostCredentialId(host.credentialId ?? "");
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
  }, [active]);

  const allHosts = hosts;
  const filteredCredentials = credentials.filter(
    (c) =>
      c.name.toLowerCase().includes(effectiveSearch.toLowerCase()) ||
      c.username.toLowerCase().includes(effectiveSearch.toLowerCase()),
  );

  const credentialFolders = Array.from(
    new Set(credentials.map((c) => c.folder || "Uncategorized")),
  ).sort();

  // Editor view: full-width with top tab bar instead of side nav
  const renderEditorView = () => {
    const isHost = !!editingHost;
    const tabs = isHost
      ? makeHostTabs(t).filter((tab) => {
          if (tab.id === "general") return true;
          if (["ssh", "tunnels", "docker", "files", "stats"].includes(tab.id))
            return editingProtocols.enableSsh;
          if (tab.id === "rdp") return editingProtocols.enableRdp;
          if (tab.id === "vnc") return editingProtocols.enableVnc;
          if (tab.id === "telnet") return editingProtocols.enableTelnet;
          return false;
        })
      : makeCredentialTabs(t);
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
            <span>
              {isHost ? t("hosts.backToHosts") : t("hosts.backToCredentials")}
            </span>
            {isHost && editingHost !== "new" && (
              <span
                className="ml-auto font-semibold text-foreground truncate max-w-[200px]"
                title={(editingHost as Host).name}
              >
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
              onSave={(saved) => {
                const updated = sshHostToHost(saved);
                setHosts((prev) => {
                  const idx = prev.findIndex((h) => h.id === updated.id);
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = updated;
                    return next;
                  }
                  return [...prev, updated];
                });
                window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
                setEditingHost(null);
                setActiveHostTab("general");
              }}
              protocols={editingProtocols}
              onProtocolChange={(p) =>
                setEditingProtocols((prev) => ({ ...prev, ...p }))
              }
              onTabChange={setActiveHostTab}
              onCredentialChange={(id) => {
                setEditingHostCredentialId(id);
              }}
              hosts={hosts}
              credentials={credentials}
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
              onSave={(saved) => {
                setCredentials((prev) => {
                  const idx = prev.findIndex((c) => c.id === String(saved.id));
                  const updated: Credential = {
                    id: String(saved.id),
                    name: saved.name,
                    username: saved.username ?? "",
                    type: saved.authType === "key" ? "key" : "password",
                    value: saved.value,
                    publicKey: saved.publicKey,
                    passphrase: saved.passphrase,
                    description: saved.description,
                    folder: saved.folder ?? "",
                    tags: saved.tags ?? [],
                  };
                  if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = updated;
                    return next;
                  }
                  return [...prev, updated];
                });
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

  useEffect(() => {
    if (active) onEditingChange?.(isEditing);
  }, [isEditing, active]);

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      {isEditing ? (
        renderEditorView()
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Search bar — hidden when parent supplies its own */}
          {!hideListHeader && (
            <div className="px-2 py-1.5 shrink-0 border-b border-border/40">
              <div className="flex items-center gap-2 px-2.5 h-7 bg-muted/60 border border-border/60">
                <Search className="size-3 text-muted-foreground/60 shrink-0" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("hosts.searchCredentialsPlaceholder")}
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
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex flex-col">
              {credentialFolders.map((folder) => {
                const creds = filteredCredentials.filter(
                  (c) => (c.folder || "Uncategorized") === folder,
                );
                if (creds.length === 0) return null;
                return (
                  <div key={folder} className="group/folder">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40 bg-muted/20">
                      <Folder className="size-3 text-muted-foreground/50 shrink-0" />
                      {editingCredFolderName === folder ? (
                        <>
                          <input
                            autoFocus
                            value={editingCredFolderValue}
                            onChange={(e) =>
                              setEditingCredFolderValue(e.target.value)
                            }
                            onBlur={async () => {
                              const newName = editingCredFolderValue.trim();
                              setEditingCredFolderName(null);
                              if (newName && newName !== folder) {
                                try {
                                  await renameCredentialFolder(folder, newName);
                                  const res = (await getCredentials()) as any;
                                  const arr = Array.isArray(res) ? res : [];
                                  setCredentials(
                                    arr.map((c: any) => ({
                                      id: String(c.id),
                                      name: c.name,
                                      username: c.username,
                                      type:
                                        c.authType === "key"
                                          ? "key"
                                          : "password",
                                      description: c.description ?? "",
                                      folder: c.folder ?? "",
                                      tags: c.tags ?? [],
                                      publicKey: c.publicKey ?? undefined,
                                    })),
                                  );
                                  toast.success(
                                    t("hosts.folderRenamedTo", {
                                      name: newName,
                                    }),
                                  );
                                } catch {
                                  toast.error(t("hosts.failedToRenameFolder"));
                                }
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape")
                                setEditingCredFolderName(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[10px] font-semibold bg-background border border-accent-brand/60 px-1 outline-none text-foreground min-w-0 flex-1"
                          />
                          <button
                            onClick={() => setEditingCredFolderName(null)}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <X className="size-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-[10px] font-semibold text-muted-foreground/70 flex-1">
                            {folder}
                          </span>
                          <span className="text-[10px] text-muted-foreground/40">
                            {creds.length}
                          </span>
                          {folder !== "Uncategorized" && (
                            <button
                              className="opacity-0 group-hover/folder:opacity-100 transition-opacity ml-1 text-muted-foreground/50 hover:text-foreground"
                              onClick={() => {
                                setEditingCredFolderName(folder);
                                setEditingCredFolderValue(folder);
                              }}
                            >
                              <Pencil className="size-2.5" />
                            </button>
                          )}
                        </>
                      )}
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
                              {(cred.username || usedByHosts.length > 0) && (
                                <span className="text-[11px] text-muted-foreground/50 truncate">
                                  {cred.username}
                                  {usedByHosts.length > 0 && (
                                    <span className="text-muted-foreground/30">
                                      {cred.username ? " · " : ""}
                                      {usedByHosts.length}h
                                    </span>
                                  )}
                                </span>
                              )}
                              {cred.tags && cred.tags.length > 0 && (
                                <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                                  {cred.tags.slice(0, 3).map((tag) => (
                                    <span
                                      key={tag}
                                      className="text-[9px] px-1 py-px border border-border/50 bg-muted/30 text-muted-foreground/60 lowercase leading-none"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {cred.tags.length > 3 && (
                                    <span className="text-[9px] text-muted-foreground/40">
                                      +{cred.tags.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {cred.type === "key" && (
                              <>
                                <button
                                  title="Deploy key to host"
                                  className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                                  onClick={() =>
                                    setDeployDialog({ cred, hostId: "" })
                                  }
                                >
                                  <Upload className="size-3" />
                                </button>
                                <button
                                  title="Copy deploy command"
                                  className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                                  onClick={() => {
                                    const pubKey = cred.publicKey;
                                    if (!pubKey) {
                                      toast.error(
                                        "No public key available — open the credential editor first",
                                      );
                                      return;
                                    }
                                    const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "${pubKey}" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
                                    navigator.clipboard.writeText(cmd);
                                    toast.success("Deploy command copied");
                                  }}
                                >
                                  <Copy className="size-3" />
                                </button>
                              </>
                            )}
                            <button
                              className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors"
                              onClick={async () => {
                                try {
                                  const full = await getCredentialDetails(
                                    Number(cred.id),
                                  );
                                  setEditingCredential({
                                    ...cred,
                                    value: (full as any).hasKey
                                      ? "existing_key"
                                      : ((full as any).password ?? ""),
                                    passphrase: (full as any).hasKeyPassword
                                      ? "existing_key_password"
                                      : "",
                                    certPublicKey:
                                      (full as any).certPublicKey ?? "",
                                  });
                                } catch {
                                  setEditingCredential(cred);
                                }
                                setActiveCredentialTab("general");
                              }}
                            >
                              <Pencil className="size-3" />
                            </button>
                            <button
                              className="size-6 flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                              onClick={() => {
                                setConfirmDialog({
                                  message: t("hosts.deleteCredentialConfirm", {
                                    name: cred.name,
                                  }),
                                  onConfirm: async () => {
                                    try {
                                      await deleteCredential(Number(cred.id));
                                      setCredentials((prev) =>
                                        prev.filter((c) => c.id !== cred.id),
                                      );
                                      toast.success(
                                        t("hosts.deletedCredential", {
                                          name: cred.name,
                                        }),
                                      );
                                    } catch {
                                      toast.error(
                                        t("hosts.failedToDeleteCredential2"),
                                      );
                                    }
                                  },
                                });
                              }}
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
              {credentialsLoading && (
                <div className="flex flex-col px-2 py-2 space-y-1.5">
                  {[60, 45, 55, 40].map((w, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2">
                      <div className="size-3 rounded-sm bg-muted/50 animate-pulse shrink-0" />
                      <div
                        className="h-3 rounded bg-muted/50 animate-pulse"
                        style={{ width: `${w * 2}px` }}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-center gap-2 pt-2 text-muted-foreground/40">
                    <Loader2 className="size-3.5 animate-spin" />
                    <span className="text-xs">
                      {t("hosts.loadingCredentials")}
                    </span>
                  </div>
                </div>
              )}
              {!credentialsLoading && filteredCredentials.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <KeyRound className="size-8 text-muted-foreground/20 mb-2" />
                  <span className="text-sm font-semibold text-muted-foreground/60">
                    {t("hosts.noCredentialsFound")}
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
                    {t("hosts.addCredentialBtn2")}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-xs flex flex-col gap-4 p-4">
            <p className="text-sm text-foreground">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                {t("hosts.cancelBtn")}
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                {t("hosts.deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deploy credential dialog */}
      {deployDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-sm flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">
                {t("hosts.deploySSHKeyTitle")}
              </span>
              <button
                onClick={() => setDeployDialog(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              {t("hosts.deployDialogDesc", { name: deployDialog.cred.name })}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("hosts.targetHostLabel")}
              </label>
              <select
                className="flex h-9 w-full border border-border bg-background px-3 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
                value={deployDialog.hostId}
                onChange={(e) =>
                  setDeployDialog({ ...deployDialog, hostId: e.target.value })
                }
              >
                <option value="">{t("hosts.selectHostOption")}</option>
                {allHosts
                  .filter(
                    (h) =>
                      h.enableSsh ||
                      (!h.enableRdp && !h.enableVnc && !h.enableTelnet),
                  )
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name || h.ip}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeployDialog(null)}
                disabled={deploying}
              >
                {t("hosts.cancelBtn")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-accent-brand/40 text-accent-brand hover:bg-accent-brand/10"
                disabled={!deployDialog.hostId || deploying}
                onClick={async () => {
                  setDeploying(true);
                  try {
                    await deployCredentialToHost(
                      Number(deployDialog.cred.id),
                      Number(deployDialog.hostId),
                    );
                    toast.success(t("hosts.keyDeployedSuccess"));
                    setDeployDialog(null);
                  } catch {
                    toast.error(t("hosts.failedToDeployKey2"));
                  } finally {
                    setDeploying(false);
                  }
                }}
              >
                {deploying ? t("hosts.deployingBtn") : t("hosts.deployBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
