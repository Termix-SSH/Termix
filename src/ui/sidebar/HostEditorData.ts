import { TERMINAL_THEMES } from "@/lib/terminal-themes";
import type { Host } from "@/types/ui-types";
import type { SSHHostData } from "@/types";

type HostSocks5ProxyNode = NonNullable<Host["socks5ProxyChain"]>[number];

export type HostProtocols = {
  enableSsh: boolean;
  enableRdp: boolean;
  enableVnc: boolean;
  enableTelnet: boolean;
};

export type HostAuthType = Host["authType"];
export type HostCursorStyle = NonNullable<
  Host["terminalConfig"]
>["cursorStyle"];
export type HostBellStyle = NonNullable<Host["terminalConfig"]>["bellStyle"];
export type HostBackspaceMode = NonNullable<
  Host["terminalConfig"]
>["backspaceMode"];
export type HostFastScrollModifier = NonNullable<
  Host["terminalConfig"]
>["fastScrollModifier"];

type SnippetListItem = {
  id: number;
  name?: string;
  title?: string;
};
type SnippetResponse = SnippetListItem[] | { snippets?: SnippetListItem[] };

export function mapSnippetResponse(
  res: unknown,
): { id: number; name: string }[] {
  const snippetRes = res as SnippetResponse;
  return (
    Array.isArray(snippetRes) ? snippetRes : (snippetRes.snippets ?? [])
  ).map((s) => ({
    id: s.id,
    name: s.name ?? s.title ?? `Snippet ${s.id}`,
  }));
}

export function createHostEditorForm(host: Host | null) {
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
    sshPort: host?.sshPort ?? host?.port ?? 22,
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
    socks5ProxyMode: ((host?.socks5ProxyChain ?? []).length > 0
      ? "chain"
      : "single") as "single" | "chain",
    socks5ProxyChain: (host?.socks5ProxyChain ?? []) as HostSocks5ProxyNode[],
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
    rightClickSelectsWord: host?.terminalConfig?.rightClickSelectsWord ?? false,
    fastScrollModifier: (host?.terminalConfig?.fastScrollModifier ?? "alt") as
      | "alt"
      | "ctrl"
      | "shift",
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
    keepaliveInterval: host?.terminalConfig?.keepaliveInterval ?? 60,
    keepaliveCountMax: host?.terminalConfig?.keepaliveCountMax ?? 5,
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
    guacamoleConfig: host?.guacamoleConfig ?? {},
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
}

export type HostEditorForm = ReturnType<typeof createHostEditorForm>;

export function buildHostEditorPayload(
  form: HostEditorForm,
  protocols: HostProtocols,
): SSHHostData {
  return {
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
    tags: form.tags,
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
      form.socks5ProxyMode === "single" ? form.socks5Username || null : null,
    socks5Password:
      form.socks5ProxyMode === "single" ? form.socks5Password || null : null,
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
      (protocols.enableRdp || protocols.enableVnc || protocols.enableTelnet) &&
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
}
