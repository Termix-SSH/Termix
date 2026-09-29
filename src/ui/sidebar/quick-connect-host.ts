import type { SSHHostData } from "@/types";
import type { Host } from "@/types/ui-types";
import type { HostProtocolDef } from "./host-protocols";
import { hostActionsFor, type HostActionDef } from "./host-contributions";

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

// The auth types quickConnectHostToPayload carries over. A plugin auth type
// keeps its fields elsewhere, so saving it here would lose them.
const SAVABLE_AUTH_TYPES = new Set([
  "password",
  "key",
  "credential",
  "none",
  "agent",
]);

export function isQuickConnectHost(host: Pick<Host, "id">): boolean {
  return host.id.startsWith(QUICK_CONNECT_ID_PREFIX);
}

export function createQuickConnectHost(input: QuickConnectInput): Host {
  const protocol = input.protocol;
  if (protocol) {
    return {
      ...createQuickConnectHost({ ...input, protocol: undefined, port: 22 }),
      // Never saved, so the login travels in plain text to the protocol's tab.
      quickConnectLogin: {
        protocol: protocol.id,
        username: input.username,
        password: input.password,
        fields: input.domain ? { domain: input.domain } : {},
      },
      port: input.port,
      enableSsh: false,
      quickConnectSavable: false,
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
    enableSsh: true,
    sshPort: input.port,
    quickConnectSavable:
      !input.authFields && SAVABLE_AUTH_TYPES.has(input.authType),
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

/**
 * Every way to reach the address: connect actions (terminal, remote desktop)
 * by priority, then tools that opted into Quick Connect. Only actions that
 * open a tab work here, since the host is never saved.
 */
export function quickConnectTargets(
  all: HostActionDef[],
  host: Host,
): HostActionDef[] {
  const usable = hostActionsFor(all, host).filter((action) => action.tabType);
  const connects = usable
    .filter((action) => action.kind === "connect")
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const tools = usable.filter(
    (action) => action.kind !== "connect" && action.quickConnect,
  );
  return [...connects, ...tools];
}
