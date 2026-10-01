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
  const login =
    host.quickConnectLogin?.protocol === connectionType
      ? host.quickConnectLogin
      : undefined;
  return {
    name: host.name ?? undefined,
    ip: host.ip ?? "",
    connectionType,
    domain: login?.fields?.domain,
    port: connectionType === "vnc" ? options.vncPort : options.rdpPort,
    rdpAuthType: "direct",
    username: login?.username,
    password: login?.password,
  };
}
