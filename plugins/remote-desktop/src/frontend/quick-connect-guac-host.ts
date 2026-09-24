import type { GuacamoleQuickHost } from "./GuacamoleApp";
import {
  hostRemoteOptions,
  type Protocol,
  type RemoteHostLogin,
} from "./host-remote";

/** The slice of a quick-connect host that GuacamoleApp mints a token from. */
export function quickConnectGuacHost(
  host: RemoteHostLogin,
): GuacamoleQuickHost {
  const options = hostRemoteOptions(host);
  const connectionType: Protocol = options.enableVnc ? "vnc" : "rdp";
  return {
    name: host.name ?? undefined,
    ip: host.ip ?? "",
    connectionType,
    domain: host.domain,
    port: connectionType === "vnc" ? options.vncPort : options.rdpPort,
    rdpAuthType: host.rdpAuthType,
    username: connectionType === "vnc" ? host.vncUser : host.rdpUser,
    password: connectionType === "vnc" ? host.vncPassword : host.rdpPassword,
  };
}
