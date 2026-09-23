import type { Host } from "@/types/ui-types";
import type { GuacamoleQuickHost } from "./GuacamoleApp";

/** The slice of a quick-connect host that GuacamoleApp mints a token from. */
export function quickConnectGuacHost(host: Host): GuacamoleQuickHost {
  return {
    name: host.name,
    ip: host.ip,
    connectionType: host.enableVnc ? "vnc" : "rdp",
    domain: host.domain,
    rdpPort: host.rdpPort,
    vncPort: host.vncPort,
    rdpAuthType: host.rdpAuthType,
    rdpUser: host.rdpUser,
    rdpPassword: host.rdpPassword,
    vncUser: host.vncUser,
    vncPassword: host.vncPassword,
  };
}
