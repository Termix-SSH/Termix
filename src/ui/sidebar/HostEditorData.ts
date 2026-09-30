import type { Host } from "@/types/ui-types";
import type { HostProtocolAuthInput, SSHHostData } from "@/types";
import {
  HOST_PROTOCOL_SECRET_KEPT,
  type HostDraft,
  type HostProtocolAuthForm,
  type HostProtocolAuthSummary,
} from "@termix/plugin-sdk/frontend";
import type { DefaultOverrides } from "@/types/host-defaults";
import {
  listHostProtocols,
  protocolPort,
  type HostProtocols,
} from "./host-protocols";

type HostSocks5ProxyNode = NonNullable<Host["socks5ProxyChain"]>[number];

export type { HostProtocols };

export type HostAuthType = Host["authType"];

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

/** A saved login as the editor form holds it; saved secrets stay behind a placeholder. */
export function protocolAuthForm(
  summaries: Record<string, HostProtocolAuthSummary> | undefined,
): Record<string, HostProtocolAuthForm> {
  const form: Record<string, HostProtocolAuthForm> = {};
  for (const [protocol, summary] of Object.entries(summaries ?? {})) {
    const fields: Record<string, string> = { ...(summary.fields ?? {}) };
    for (const key of summary.secretFieldKeys ?? []) {
      fields[key] = HOST_PROTOCOL_SECRET_KEPT;
    }
    form[protocol] = {
      authType:
        summary.authType ?? (summary.credentialId ? "credential" : "direct"),
      credentialId:
        summary.credentialId != null ? String(summary.credentialId) : "",
      username: summary.username ?? "",
      password: summary.hasPassword ? HOST_PROTOCOL_SECRET_KEPT : "",
      fields,
    };
  }
  return form;
}

/**
 * The logins a host save sends: one per plugin protocol the editor knows,
 * removed when its switch is off. A saved secret left alone is not sent.
 */
export function protocolAuthPayload(
  form: Record<string, HostProtocolAuthForm>,
  protocols: HostProtocols,
): Record<string, HostProtocolAuthInput | null> {
  const payload: Record<string, HostProtocolAuthInput | null> = {};
  for (const protocol of listHostProtocols()) {
    if (!protocols[protocol.settingKey]) {
      payload[protocol.id] = null;
      continue;
    }
    const login = form[protocol.id];
    if (!login) continue;
    const direct = login.authType === "direct";
    payload[protocol.id] = {
      authType: login.authType,
      credentialId:
        login.authType === "credential" && login.credentialId
          ? Number(login.credentialId)
          : null,
      username: direct ? login.username || null : null,
      ...(direct && login.password !== HOST_PROTOCOL_SECRET_KEPT
        ? { password: login.password || null }
        : {}),
      fields: Object.fromEntries(
        Object.entries(login.fields).filter(
          ([, value]) => value !== HOST_PROTOCOL_SECRET_KEPT,
        ),
      ),
    };
  }
  return payload;
}

export function createHostEditorForm(host: Host | null) {
  const sshOptions = host?.sshOptions ?? {};

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
    credentialId: host?.credentialId != null ? String(host.credentialId) : "",
    overrideCredentialUsername: host?.overrideCredentialUsername ?? false,
    folder: host?.folder ?? "",
    parentHostId: host?.parentHostId ?? "",
    tags: host?.tags ?? ([] as string[]),
    tagInput: "",
    notes: host?.notes ?? "",
    pin: host?.pin ?? false,
    useSocks5: host?.useSocks5 ?? false,
    socks5Host: host?.socks5Host ?? "",
    socks5Port: host?.socks5Port ?? 1080,
    socks5Username: host?.socks5Username ?? "",
    socks5Password: host?.socks5Password ?? "",
    socks5ProxyMode: ((host?.socks5ProxyChain ?? []).length > 0
      ? "chain"
      : "single") as "single" | "chain",
    socks5ProxyChain: (host?.socks5ProxyChain ?? []) as HostSocks5ProxyNode[],
    connectionOrigin: (host?.connectionOrigin ?? null) as
      "local" | "remote" | null,
    localOnly: host?.localOnly ?? false,
    forceKeyboardInteractive: host?.forceKeyboardInteractive ?? false,
    sudoPassword: host?.hasSudoPassword
      ? "existing_sudo_password"
      : (host?.sudoPassword ?? ""),
    keepaliveInterval: sshOptions.keepaliveInterval ?? 60,
    keepaliveCountMax: sshOptions.keepaliveCountMax ?? 5,
    allowLegacyAlgorithms: sshOptions.allowLegacyAlgorithms ?? true,
    agentForwarding: sshOptions.agentForwarding ?? false,
    agentSocketPath: sshOptions.agentSocketPath ?? "",
    agentIdentity: sshOptions.agentIdentity ?? "",
    environmentVariables:
      sshOptions.environmentVariables ??
      ([] as { key: string; value: string }[]),
    jumpHosts: host?.jumpHosts ?? ([] as { hostId: string }[]),
    portKnockSequence:
      host?.portKnockSequence ??
      ([] as { port: number; protocol: "tcp" | "udp"; delay: number }[]),
    // Each plugin protocol's login, edited by that plugin's host editor tab.
    protocolAuth: protocolAuthForm(host?.protocolAuth),
    statusCheckEnabled: host?.statusCheckEnabled ?? true,
    statusCheckInterval: (host?.statusCheckInterval ?? null) as number | null,

    // Host-scope plugin settings, keyed by plugin id. Loaded with the host and
    // saved through the plugin's own scoped route, not in the host payload.
    pluginSettings: (host?.pluginSettings ?? {}) as Record<
      string,
      Record<string, unknown>
    >,

    // Host default keys the host sets itself; the rest follow its defaults.
    // Null until known, for a host saved before host defaults.
    defaultOverrides: (host
      ? (host.defaultOverrides ?? null)
      : {}) as DefaultOverrides | null,
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

  const sshOptions = editableFields.sshOptions
    ? { ...editableFields.sshOptions }
    : undefined;
  if (sshOptions) delete sshOptions.agentSocketPath;

  return {
    ...editableFields,
    sshOptions,
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
    localOnly: form.localOnly,
    enableSsh: protocols.enableSsh,
    sshPort: Number(form.sshPort),
    forceKeyboardInteractive: form.forceKeyboardInteractive,
    protocolAuth: protocolAuthPayload(form.protocolAuth, protocols),
    // The editor keeps ids as strings; the API and every backend lookup take
    // a number, and a string id does not compare equal on Postgres/MySQL.
    jumpHosts: form.jumpHosts.map((j) => ({ hostId: Number(j.hostId) })),
    portKnockSequence: form.portKnockSequence,
    statusCheckEnabled: form.statusCheckEnabled,
    statusCheckInterval: form.statusCheckInterval,
    ...(form.defaultOverrides
      ? { defaultOverrides: form.defaultOverrides }
      : {}),
    // Left out with SSH off, so the stored values stay as they are.
    ...(protocols.enableSsh
      ? {
          sudoPassword:
            form.sudoPassword === "existing_sudo_password"
              ? undefined
              : form.sudoPassword || "",
          sshOptions: {
            keepaliveInterval: Number(form.keepaliveInterval),
            keepaliveCountMax: Number(form.keepaliveCountMax),
            allowLegacyAlgorithms: form.allowLegacyAlgorithms,
            agentForwarding: form.agentForwarding,
            agentSocketPath: usesAgent ? form.agentSocketPath || null : null,
            agentIdentity: usesAgent ? form.agentIdentity || null : null,
            environmentVariables: form.environmentVariables,
          },
        }
      : {}),
  };
}
