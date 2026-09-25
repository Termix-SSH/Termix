import type { SSHHostData } from "@/types";
import type { Host } from "@/types/ui-types";
import type { HostProtocolDef } from "./host-protocols";

type QuickConnectInput = Pick<
  Host,
  "ip" | "port" | "username" | "authType" | "password" | "key" | "credentialId"
> & {
  /** A plugin protocol; SSH when omitted. */
  protocol?: HostProtocolDef;
  domain?: string;
  /** Fields a plugin's SSH auth editor filled in. */
  authFields?: Record<string, unknown>;
};

const QUICK_CONNECT_ID_PREFIX = "quick-connect-";

export function isQuickConnectHost(host: Pick<Host, "id">): boolean {
  return host.id.startsWith(QUICK_CONNECT_ID_PREFIX);
}

export function createQuickConnectHost(input: QuickConnectInput): Host {
  const protocol = input.protocol;
  if (protocol) {
    // Protocol logins are core host fields named after the protocol.
    const login = {
      [`${protocol.id}AuthType`]: "direct",
      [`${protocol.id}User`]: input.username,
      [`${protocol.id}Password`]: input.password,
    };
    return {
      ...createQuickConnectHost({ ...input, protocol: undefined, port: 22 }),
      ...login,
      port: input.port,
      enableSsh: false,
      domain: input.domain,
      pluginSettings: {
        [protocol.pluginId]: {
          [protocol.settingKey]: true,
          ...(protocol.portKey ? { [protocol.portKey]: input.port } : {}),
        },
      },
    };
  }
  return {
    id: `${QUICK_CONNECT_ID_PREFIX}${Date.now()}`,
    name: `${input.username}@${input.ip}`,
    ip: input.ip,
    port: input.port,
    username: input.username,
    authType: input.authType,
    password: input.authType === "password" ? input.password : undefined,
    key: input.authType === "key" ? input.key : undefined,
    credentialId:
      input.authType === "credential" ? input.credentialId : undefined,
    folder: "",
    online: false,
    cpu: null,
    ram: null,
    lastAccess: new Date().toISOString(),
    pin: false,
    quickActions: [],
    enableSsh: true,
    sshPort: input.port,
    ...input.authFields,
  };
}

export function quickConnectHostToPayload(host: Host): SSHHostData {
  return {
    name: host.name,
    ip: host.ip,
    port: host.port,
    username: host.username,
    authType: host.authType,
    password: host.password,
    key: host.key,
    credentialId: host.credentialId
      ? Number.parseInt(host.credentialId, 10)
      : null,
    folder: host.folder,
    pin: host.pin,
    connectionType: "ssh",
    enableSsh: true,
    sshPort: host.sshPort,
  };
}
