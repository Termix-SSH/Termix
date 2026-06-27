import type { Host, TabType } from "@/types/ui-types";

type ConnectionTabType = "terminal" | "rdp" | "vnc" | "telnet";

function isConnectionTabType(type: TabType): type is ConnectionTabType {
  return (
    type === "terminal" || type === "rdp" || type === "vnc" || type === "telnet"
  );
}

function isConnectionEnabled(host: Host, type: ConnectionTabType): boolean {
  switch (type) {
    case "terminal":
      return host.enableSsh;
    case "rdp":
      return host.enableRdp;
    case "vnc":
      return host.enableVnc;
    case "telnet":
      return host.enableTelnet;
  }
}

export function getDefaultConnectionTab(host: Host): ConnectionTabType {
  if (host.enableSsh) return "terminal";
  if (host.enableRdp) return "rdp";
  if (host.enableVnc) return "vnc";
  if (host.enableTelnet) return "telnet";
  return "terminal";
}

export function resolveHostTabType(
  host: Host,
  preferredType?: TabType,
): TabType {
  if (!preferredType) return getDefaultConnectionTab(host);
  if (!isConnectionTabType(preferredType)) return preferredType;
  if (isConnectionEnabled(host, preferredType)) return preferredType;
  return getDefaultConnectionTab(host);
}
