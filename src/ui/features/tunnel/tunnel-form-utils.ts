import type { TunnelMode } from "@/types/index.js";

type Translate = (
  key: string,
  options?: Record<string, string | number>,
) => string;

export function getTunnelTypeForMode(mode: TunnelMode): "local" | "remote" {
  return mode === "remote" ? "remote" : "local";
}

export function getTunnelPortLabels(
  scope: "client" | "server",
  mode: TunnelMode,
  t: Translate,
) {
  if (scope === "client") {
    return {
      sourcePortLabel:
        mode === "remote" ? t("tunnels.remotePort") : t("tunnels.localPort"),
      endpointPortLabel:
        mode === "remote" ? t("tunnels.localPort") : t("tunnels.remotePort"),
    };
  }

  return {
    sourcePortLabel: t("tunnels.currentHostPort"),
    endpointPortLabel: t("tunnels.endpointPort"),
  };
}

export function getTunnelModeDescription(
  scope: "client" | "server",
  mode: TunnelMode,
  ports: {
    sourcePort: string | number;
    endpointPort: string | number;
  },
  t: Translate,
) {
  if (scope === "client") {
    if (mode === "dynamic") {
      return t("tunnels.forwardDescriptionClientDynamic", {
        sourcePort: ports.sourcePort,
      });
    }
    if (mode === "local") {
      return t("tunnels.forwardDescriptionClientLocal", ports);
    }
    return t("tunnels.forwardDescriptionClientRemote", ports);
  }

  if (mode === "dynamic") {
    return t("tunnels.forwardDescriptionServerDynamic", {
      sourcePort: ports.sourcePort,
    });
  }
  if (mode === "local") {
    return t("tunnels.forwardDescriptionServerLocal", ports);
  }
  return t("tunnels.forwardDescriptionServerRemote", ports);
}
