import { TERMINAL_THEMES } from "@/lib/terminal-themes";
import type { Host } from "@/types/ui-types";
import type { SSHHostData } from "@/types";
import type { HostDraft } from "@termix/plugin-sdk/frontend";
import type { HostDefaults } from "@/api/settings-api";
import type { TerminalDefaults } from "@/lib/connection-defaults";
import {
  listHostProtocols,
  protocolPort,
  type HostProtocols,
} from "./host-protocols";

type HostSocks5ProxyNode = NonNullable<Host["socks5ProxyChain"]>[number];

export type { HostProtocols };

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

export const terminalAppearanceKeys = [
  "theme",
  "cursorBlink",
  "cursorStyle",
  "fontSize",
  "fontFamily",
  "scrollback",
  "letterSpacing",
  "lineHeight",
  "bellStyle",
  "minimumContrastRatio",
  "backgroundImage",
  "backgroundImageOpacity",
  "customThemeColors",
] as const satisfies readonly (keyof TerminalDefaults)[];

export interface UserConnectionDefaults {
  terminal: TerminalDefaults;
}

function hasOwn(value: object | undefined, key: PropertyKey): boolean {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function stripKeys<T extends Record<string, unknown>>(
  value: T,
  keys: readonly string[],
): Partial<T> {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

type SnippetListItem = {
  id: number;
  name?: string;
  title?: string;
};
type SnippetResponse = SnippetListItem[] | { snippets?: SnippetListItem[] };

/**
 * Whether the Connection Origin control is meaningful for a host.
 *
 * Every protocol Termix can dial from either backend belongs here, plugin
 * protocols included (Termix-SSH/Support#1240); before that the control was
 * gated on SSH alone, so a host enabling only remote desktop could never
 * reach the setting.
 */
export function connectionOriginAppliesTo(protocols: HostProtocols): boolean {
  return Object.values(protocols).some(Boolean);
}

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

/** Overlays a plugin's draft on a new host's form. */
export function applyHostDraft(
  form: HostEditorForm,
  draft: HostDraft | undefined,
): HostEditorForm {
  if (!draft) return form;
  return {
    ...form,
    ...(draft.name !== undefined ? { name: draft.name } : {}),
    ...(draft.ip !== undefined ? { ip: draft.ip } : {}),
    ...(draft.port !== undefined ? { sshPort: draft.port } : {}),
    ...(draft.username !== undefined ? { username: draft.username } : {}),
    ...(draft.authType !== undefined
      ? { authType: draft.authType as HostAuthType }
      : {}),
  };
}

export function createHostEditorForm(
  host: Host | null,
  defaults?: HostDefaults,
  connectionDefaults?: UserConnectionDefaults,
) {
  const d = host ? undefined : defaults;
  const terminalConfig = {
    ...(connectionDefaults?.terminal ?? {}),
    ...(host?.terminalConfig ?? {}),
  };
  const rawTheme = terminalConfig.theme ?? d?.theme;
  const normalizedTheme =
    !rawTheme ||
    ["Termix Dark", "Termix Light", "termixDark", "termixLight"].includes(
      rawTheme,
    )
      ? "termix"
      : rawTheme === "custom" || TERMINAL_THEMES[rawTheme]
        ? rawTheme
        : "termix";

  return {
    name: host?.name ?? "",
    ip: host?.ip ?? "",
    username: host?.username ?? (host ? "" : "root"),
    sshPort: host?.sshPort ?? host?.port ?? 22,
    authType: host?.authType ?? "password",
    shareSshAuth: host?.shareSshAuth ?? false,
    password: host?.hasPassword ? "existing_password" : (host?.password ?? ""),
    key: host?.key ?? (host?.hasKey ? "existing_key" : ""),
    keyPassword: host?.hasKeyPassword
      ? "existing_key_password"
      : (host?.keyPassword ?? ""),
    keyType: host?.keyType ?? "auto",
    keySubTab: "paste" as "paste" | "upload",
    credentialId:
      host?.credentialId != null
        ? String(host.credentialId)
        : d?.credentialId != null
          ? String(d.credentialId)
          : "",
    overrideCredentialUsername: host?.overrideCredentialUsername ?? false,
    folder: host?.folder ?? "",
    parentHostId: host?.parentHostId ?? "",
    tags: host?.tags ?? ([] as string[]),
    tagInput: "",
    notes: host?.notes ?? "",
    pin: host?.pin ?? false,
    useSocks5: host?.useSocks5 ?? d?.useSocks5 ?? false,
    socks5Host: host?.socks5Host ?? d?.socks5Host ?? "",
    socks5Port: host?.socks5Port ?? d?.socks5Port ?? 1080,
    socks5Username: host?.socks5Username ?? d?.socks5Username ?? "",
    socks5Password: host?.socks5Password ?? d?.socks5Password ?? "",
    socks5ProxyMode: ((host?.socks5ProxyChain ?? []).length > 0
      ? "chain"
      : "single") as "single" | "chain",
    socks5ProxyChain: (host?.socks5ProxyChain ?? []) as HostSocks5ProxyNode[],
    connectionOrigin: (host?.connectionOrigin ?? null) as
      "local" | "remote" | null,
    forceKeyboardInteractive: host?.forceKeyboardInteractive ?? false,
    inheritTerminalAppearance:
      !host ||
      terminalAppearanceKeys.every((key) => !hasOwn(host.terminalConfig, key)),
    localEcho: host?.terminalConfig?.localEcho ?? "default",
    fontSize: terminalConfig.fontSize ?? d?.fontSize ?? 14,
    fontFamily:
      terminalConfig.fontFamily ??
      d?.fontFamily ??
      "Caskaydia Cove Nerd Font Mono",
    theme: normalizedTheme,
    cursorStyle: (terminalConfig.cursorStyle ?? d?.cursorStyle ?? "bar") as
      "block" | "underline" | "bar",
    cursorBlink: terminalConfig.cursorBlink ?? d?.cursorBlink ?? true,
    scrollback: terminalConfig.scrollback ?? 10000,
    letterSpacing: terminalConfig.letterSpacing ?? 0,
    lineHeight: terminalConfig.lineHeight ?? 1.0,
    bellStyle: (terminalConfig.bellStyle ?? "none") as
      "none" | "sound" | "visual" | "both",
    rightClickSelectsWord: host?.terminalConfig?.rightClickSelectsWord ?? false,
    macOptionIsMeta: host?.terminalConfig?.macOptionIsMeta ?? false,
    fastScrollModifier: (host?.terminalConfig?.fastScrollModifier ?? "alt") as
      "alt" | "ctrl" | "shift",
    fastScrollSensitivity: host?.terminalConfig?.fastScrollSensitivity ?? 5,
    minimumContrastRatio: terminalConfig.minimumContrastRatio ?? 1,
    backspaceMode: (host?.terminalConfig?.backspaceMode ?? "normal") as
      "normal" | "control-h",
    startupSnippetId: host?.terminalConfig?.startupSnippetId ?? null,
    moshCommand: host?.terminalConfig?.moshCommand ?? "",
    agentForwarding: host?.terminalConfig?.agentForwarding ?? false,
    autoMosh: host?.terminalConfig?.autoMosh ?? false,
    autoTmux: host?.terminalConfig?.autoTmux ?? d?.autoTmux ?? false,
    sudoPasswordAutoFill: host?.terminalConfig?.sudoPasswordAutoFill ?? false,
    sudoPassword: host?.hasSudoPassword
      ? "existing_sudo_password"
      : (host?.terminalConfig?.sudoPassword ?? ""),
    keepaliveInterval: host?.terminalConfig?.keepaliveInterval ?? 60,
    keepaliveCountMax: host?.terminalConfig?.keepaliveCountMax ?? 5,
    backgroundImage: terminalConfig.backgroundImage ?? "",
    backgroundImageOpacity: terminalConfig.backgroundImageOpacity ?? 0.15,
    customThemeColors: terminalConfig.customThemeColors ?? null,
    allowLegacyAlgorithms: host?.terminalConfig?.allowLegacyAlgorithms ?? true,
    linkClickBehavior: (host?.terminalConfig?.linkClickBehavior ??
      "default") as "default" | "confirm" | "direct",
    agentSocketPath: host?.terminalConfig?.agentSocketPath ?? "",
    agentIdentity: host?.terminalConfig?.agentIdentity ?? "",
    useSSHTitle: host?.terminalConfig?.useSSHTitle ?? false,
    syntaxHighlighting: host?.terminalConfig?.syntaxHighlighting ?? true,
    syntaxHighlightingOptions: {
      logLevels:
        host?.terminalConfig?.syntaxHighlightingOptions?.logLevels ?? true,
      paths: host?.terminalConfig?.syntaxHighlightingOptions?.paths ?? true,
      timestamps:
        host?.terminalConfig?.syntaxHighlightingOptions?.timestamps ?? true,
      ipAddresses:
        host?.terminalConfig?.syntaxHighlightingOptions?.ipAddresses ?? true,
      urls: host?.terminalConfig?.syntaxHighlightingOptions?.urls ?? true,
      numbers: host?.terminalConfig?.syntaxHighlightingOptions?.numbers ?? true,
    },
    environmentVariables:
      host?.terminalConfig?.environmentVariables ??
      ([] as { key: string; value: string }[]),
    jumpHosts: host?.jumpHosts ?? ([] as { hostId: string }[]),
    portKnockSequence:
      host?.portKnockSequence ??
      ([] as { port: number; protocol: "tcp" | "udp"; delay: number }[]),
    quickActions:
      host?.quickActions ?? ([] as { name: string; snippetId: string }[]),
    rdpCredentialId: host?.rdpCredentialId ?? "",
    rdpUser: host?.rdpUser ?? "",
    rdpPassword: host?.hasRdpPassword
      ? "existing_rdp_password"
      : (host?.rdpPassword ?? ""),
    domain: host?.domain ?? "",
    vncCredentialId: host?.vncCredentialId ?? "",
    vncPassword: host?.hasVncPassword
      ? "existing_vnc_password"
      : (host?.vncPassword ?? ""),
    vncUser: host?.vncUser ?? "",
    telnetUser: host?.telnetUser ?? "",
    telnetPassword: host?.hasTelnetPassword
      ? "existing_telnet_password"
      : (host?.telnetPassword ?? ""),
    telnetCredentialId:
      host?.telnetCredentialId != null ? String(host.telnetCredentialId) : "",
    rdpAuthType: (host?.rdpAuthType ??
      (host?.rdpCredentialId ? "credential" : "direct")) as
      "direct" | "credential" | "none",
    vncAuthType: (host?.vncAuthType ??
      (host?.vncCredentialId ? "credential" : "direct")) as
      "direct" | "credential",
    telnetAuthType: (host?.telnetAuthType ??
      (host?.telnetCredentialId ? "credential" : "direct")) as
      "direct" | "credential",
    statusCheckEnabled:
      host?.statusCheckEnabled ?? d?.statusCheckEnabled ?? true,
    statusCheckInterval: (host?.statusCheckInterval ?? null) as number | null,

    // Host-scope plugin settings, keyed by plugin id. Loaded with the host and
    // saved through the plugin's own scoped route, not in the host payload.
    pluginSettings: (host?.pluginSettings ?? {}) as Record<
      string,
      Record<string, unknown>
    >,
  };
}

export type HostEditorForm = ReturnType<typeof createHostEditorForm>;

export function omitOwnerSshAuthFromSharedEdit(
  payload: SSHHostData,
): SSHHostData {
  const {
    authType: _authType,
    password: _password,
    key: _key,
    keyPassword: _keyPassword,
    keyType: _keyType,
    sudoPassword: _sudoPassword,
    credentialId: _credentialId,
    overrideCredentialUsername: _overrideCredentialUsername,
    shareSshAuth: _shareSshAuth,
    ...editableFields
  } = payload;

  const terminalConfig = editableFields.terminalConfig
    ? { ...editableFields.terminalConfig }
    : undefined;
  if (terminalConfig) {
    delete terminalConfig.sudoPassword;
    delete terminalConfig.agentSocketPath;
  }

  return {
    ...editableFields,
    terminalConfig,
  } as SSHHostData;
}

export function buildHostEditorPayload(
  form: HostEditorForm,
  protocols: HostProtocols,
): SSHHostData {
  // Only carry the auth fields that belong to the selected method so switching
  // method (e.g. on a cloned host) doesn't leave a stale credentialId or key
  // behind that the backend would keep resolving.
  const usesCredential = form.authType === "credential";
  const usesKey = form.authType === "key";
  const usesPassword = form.authType === "password";
  const usesAgent = form.authType === "agent";
  // With SSH off, the host's primary protocol is the first plugin protocol
  // switched on, and its port stands in for the host port.
  const primaryProtocol = protocols.enableSsh
    ? undefined
    : listHostProtocols().find((protocol) => protocols[protocol.settingKey]);
  const terminalConfig = {
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
    macOptionIsMeta: form.macOptionIsMeta,
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
    sudoPassword:
      form.sudoPassword === "existing_sudo_password"
        ? undefined
        : form.sudoPassword || null,
    keepaliveInterval: Number(form.keepaliveInterval),
    keepaliveCountMax: Number(form.keepaliveCountMax),
    environmentVariables: form.environmentVariables,
    useSSHTitle: form.useSSHTitle,
    syntaxHighlighting: form.syntaxHighlighting,
    syntaxHighlightingOptions: form.syntaxHighlightingOptions,
    backgroundImage: form.backgroundImage || null,
    backgroundImageOpacity: Number(form.backgroundImageOpacity),
    customThemeColors: form.theme === "custom" ? form.customThemeColors : null,
    allowLegacyAlgorithms: form.allowLegacyAlgorithms,
    linkClickBehavior:
      form.linkClickBehavior !== "default" ? form.linkClickBehavior : undefined,
    localEcho: form.localEcho !== "default" ? form.localEcho : undefined,
    agentSocketPath: usesAgent ? form.agentSocketPath || null : null,
    agentIdentity: usesAgent ? form.agentIdentity || null : null,
  };
  const terminalOverrides = form.inheritTerminalAppearance
    ? stripKeys(terminalConfig, terminalAppearanceKeys)
    : terminalConfig;

  return {
    connectionType: primaryProtocol?.id ?? "ssh",
    name: form.name,
    ip: form.ip,
    port: primaryProtocol
      ? protocolPort(form.pluginSettings, primaryProtocol)
      : Number(form.sshPort),
    username: form.username,
    folder: form.folder,
    parentHostId: form.parentHostId ? Number(form.parentHostId) : null,
    tags: form.tags,
    pin: form.pin,
    authType: form.authType,
    shareSshAuth: form.shareSshAuth,
    password:
      usesPassword || usesKey || usesCredential
        ? form.password === "existing_password"
          ? undefined
          : form.password || null
        : null,
    key: usesKey
      ? form.key === "existing_key"
        ? undefined
        : form.key || null
      : null,
    keyPassword: usesKey
      ? form.keyPassword === "existing_key_password"
        ? undefined
        : form.keyPassword || null
      : null,
    keyType: usesKey && form.keyType !== "auto" ? form.keyType : null,
    credentialId:
      usesCredential && form.credentialId ? Number(form.credentialId) : null,
    overrideCredentialUsername: form.overrideCredentialUsername,
    notes: form.notes,
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
    connectionOrigin: form.connectionOrigin,
    enableSsh: protocols.enableSsh,
    sshPort: Number(form.sshPort),
    forceKeyboardInteractive: form.forceKeyboardInteractive,
    rdpAuthType: protocols.enableRdp ? form.rdpAuthType : null,
    rdpCredentialId:
      protocols.enableRdp &&
      form.rdpAuthType === "credential" &&
      form.rdpCredentialId
        ? Number(form.rdpCredentialId)
        : null,
    rdpUser:
      protocols.enableRdp && form.rdpAuthType === "direct"
        ? form.rdpUser || null
        : null,
    rdpPassword:
      protocols.enableRdp &&
      form.rdpAuthType === "direct" &&
      form.rdpPassword !== "existing_rdp_password"
        ? form.rdpPassword || null
        : null,
    rdpDomain: form.domain || null,
    vncAuthType: protocols.enableVnc ? form.vncAuthType : null,
    vncCredentialId:
      protocols.enableVnc &&
      form.vncAuthType === "credential" &&
      form.vncCredentialId
        ? Number(form.vncCredentialId)
        : null,
    vncPassword:
      protocols.enableVnc &&
      form.vncAuthType === "direct" &&
      form.vncPassword !== "existing_vnc_password"
        ? form.vncPassword || null
        : null,
    vncUser:
      protocols.enableVnc && form.vncAuthType === "direct"
        ? form.vncUser || null
        : null,
    telnetAuthType: protocols.enableTelnet ? form.telnetAuthType : null,
    telnetCredentialId:
      protocols.enableTelnet &&
      form.telnetAuthType === "credential" &&
      form.telnetCredentialId
        ? Number(form.telnetCredentialId)
        : null,
    telnetUser:
      protocols.enableTelnet && form.telnetAuthType === "direct"
        ? form.telnetUser || null
        : null,
    telnetPassword:
      protocols.enableTelnet &&
      form.telnetAuthType === "direct" &&
      form.telnetPassword !== "existing_telnet_password"
        ? form.telnetPassword || null
        : null,
    // The editor keeps ids as strings; the API and every backend lookup take
    // a number, and a string id does not compare equal on Postgres/MySQL.
    jumpHosts: form.jumpHosts.map((j) => ({ hostId: Number(j.hostId) })),
    portKnockSequence: form.portKnockSequence,
    quickActions: form.quickActions.map((a) => ({
      name: a.name,
      snippetId: Number(a.snippetId),
    })),
    statusCheckEnabled: form.statusCheckEnabled,
    statusCheckInterval: form.statusCheckInterval,
    terminalConfig: protocols.enableSsh ? terminalOverrides : null,
  };
}
