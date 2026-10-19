import {
  createCurrentCredentialRepository,
  createCurrentHostResolutionRepository,
} from "../../database/repositories/factory.js";
import { hostTerminalExport } from "../../database/routes/host-normalizers.js";
import { loadHostPluginSettings } from "../../database/routes/host-plugin-settings.js";
import {
  listProtocolLogins,
  toPortableLogins,
} from "../protocol-auth/protocol-auth.js";
import { findHostProtocol } from "../protocol-auth/registry.js";
import { resolveHostCredentials } from "../resolve-host-credentials.js";

/**
 * A share export leaves out every secret and credential link, the same as
 * it does for SSH.
 */
function shareableLogins(
  logins: ReturnType<typeof toPortableLogins>,
  shareMode: boolean,
): ReturnType<typeof toPortableLogins> {
  if (!shareMode) return logins;
  const out: ReturnType<typeof toPortableLogins> = {};
  for (const [protocol, login] of Object.entries(logins)) {
    const declared = findHostProtocol(protocol);
    const secret = new Set(
      (declared?.credentialFields ?? [])
        .filter((field) => field.secret)
        .map((field) => field.key),
    );
    out[protocol] = {
      authType: login.authType === "credential" ? "direct" : login.authType,
      credentialId: null,
      username: login.username,
      password: null,
      fields: Object.fromEntries(
        Object.entries(login.fields).filter(
          ([key]) => declared && !secret.has(key),
        ),
      ),
    };
  }
  return out;
}

type Row = Record<string, unknown>;

/** One host as the Termix JSON export carries it. */
async function exportRow(
  host: Row,
  userId: string,
  shareMode: boolean,
  pluginSettings: Awaited<ReturnType<typeof loadHostPluginSettings>>,
): Promise<{ data: Row; isRemoteDesktop: boolean; resolved: Row }> {
  const resolvedHost = shareMode
    ? host
    : (await resolveHostCredentials(host, userId)) || host;
  const connectionType = (resolvedHost.connectionType as string) || "ssh";
  const isRemoteDesktop = connectionType !== "ssh";

  const base = {
    exportId: resolvedHost.id,
    connectionType,
    name: resolvedHost.name,
    ip: resolvedHost.ip,
    port: resolvedHost.port,
    username: resolvedHost.username,
    password: shareMode ? null : resolvedHost.password || null,
    folder: resolvedHost.folder,
    tags:
      typeof resolvedHost.tags === "string"
        ? resolvedHost.tags.split(",").filter(Boolean)
        : resolvedHost.tags || [],
    pin: !!resolvedHost.pin,
    notes: resolvedHost.notes || null,
    // Every plugin's host settings, secrets redacted, for import to hand back.
    pluginSettings: pluginSettings.get(host.id as number) ?? {},
    // Each plugin protocol's login, secrets included like the SSH ones.
    protocolAuth: shareableLogins(
      toPortableLogins(await listProtocolLogins(host.id as number, userId)),
      shareMode,
    ),
  };

  if (isRemoteDesktop) {
    return { data: base, isRemoteDesktop, resolved: resolvedHost };
  }

  const terminal = hostTerminalExport(resolvedHost);
  const data = {
    ...base,
    authType: resolvedHost.authType,
    key: shareMode ? null : resolvedHost.key || null,
    keyPassword: shareMode ? null : resolvedHost.keyPassword || null,
    keyType: resolvedHost.keyType || null,
    credentialId: resolvedHost.credentialId || null,
    overrideCredentialUsername: !!resolvedHost.overrideCredentialUsername,
    sudoPassword: shareMode ? null : resolvedHost.sudoPassword || null,
    jumpHosts: resolvedHost.jumpHosts
      ? JSON.parse(resolvedHost.jumpHosts as string)
      : null,
    terminalConfig: terminal.terminalConfig ?? null,
    sshOptions: terminal.sshOptions,
    forceKeyboardInteractive: resolvedHost.forceKeyboardInteractive === "true",
    useSocks5: !!resolvedHost.useSocks5,
    socks5Host: resolvedHost.socks5Host || null,
    socks5Port: resolvedHost.socks5Port || null,
    socks5Username: resolvedHost.socks5Username || null,
    socks5Password: shareMode ? null : resolvedHost.socks5Password || null,
    socks5ProxyChain: resolvedHost.socks5ProxyChain
      ? JSON.parse(resolvedHost.socks5ProxyChain as string)
      : null,
    portKnockSequence: resolvedHost.portKnockSequence
      ? JSON.parse(resolvedHost.portKnockSequence as string)
      : null,
  };
  return { data, isRemoteDesktop, resolved: resolvedHost };
}

export interface HostExport {
  hosts: Row[];
  /** Share mode only. */
  version?: string;
  exportedAt?: string;
  credentials?: Row[];
}

/**
 * All of the user's own hosts. Without shareMode credentials are decrypted and
 * embedded. With it every secret is left out and credential logins point at a
 * scrubbed credentials list by alias.
 */
export async function exportAllHosts(
  userId: string,
  shareMode: boolean,
  hostIds?: number[],
): Promise<HostExport> {
  const owned =
    await createCurrentHostResolutionRepository().findHostsByUserId(userId);
  const wanted = hostIds ? new Set(hostIds) : null;
  const allHosts = wanted
    ? owned.filter((host) => wanted.has(host.id as number))
    : owned;
  const settings = await loadHostPluginSettings(
    allHosts.map((h) => h.id as number),
  );

  const hosts: Row[] = [];
  const usedCredentialIds = new Set<number>();

  for (const host of allHosts) {
    const { data, isRemoteDesktop, resolved } = await exportRow(
      host as unknown as Row,
      userId,
      shareMode,
      settings,
    );
    if (
      shareMode &&
      !isRemoteDesktop &&
      resolved.authType === "credential" &&
      resolved.credentialId
    ) {
      usedCredentialIds.add(resolved.credentialId as number);
    }
    hosts.push(data);
  }

  if (!shareMode) return { hosts };

  const credentials: Row[] = [];
  if (usedCredentialIds.size > 0) {
    const owned =
      await createCurrentCredentialRepository().listDecryptedByUserId(userId);
    const byId = new Map(
      owned.map((credential) => [credential.id, credential]),
    );

    for (const host of hosts) {
      const credentialId = host.credentialId as number | null;
      if (!credentialId) continue;
      const credential = byId.get(credentialId);
      if (!credential) continue;

      host.credentialAlias = credential.name;

      if (!credentials.some((entry) => entry.alias === credential.name)) {
        credentials.push({
          alias: credential.name,
          name: credential.name,
          description: credential.description || null,
          folder: credential.folder || null,
          tags:
            typeof credential.tags === "string"
              ? credential.tags.split(",").filter(Boolean)
              : [],
          authType: credential.authType,
          username: credential.username || null,
          keyType: credential.keyType || null,
        });
      }
    }
  }

  for (const host of hosts) delete host.credentialId;

  return {
    version: "1",
    exportedAt: new Date().toISOString(),
    credentials,
    hosts,
  };
}
