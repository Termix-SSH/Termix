export type MetaKeyFamily = "win" | "super" | "cmd";

export interface MetaKeyLabels {
  family: MetaKeyFamily;
  short: string;
  lock: string;
  stickyKey: string;
  keyTooltip: string;
  lockTooltip: string;
}

/**
 * RDP is a Windows desktop, so the toolbar keeps Windows labels. VNC is used
 * for Linux and macOS as often as Windows; branding those sessions with a
 * Windows key is wrong, and the local device is the only OS we can see.
 */
export function detectMetaKeyFamily(
  protocol: "rdp" | "vnc" | "telnet",
  env: {
    platform?: string;
    userAgent?: string;
    userAgentDataPlatform?: string;
  } = {},
): MetaKeyFamily {
  if (protocol === "rdp") return "win";

  const uaPlatform = env.userAgentDataPlatform ?? "";
  const platform = env.platform ?? "";
  const userAgent = env.userAgent ?? "";
  const haystack = `${uaPlatform} ${platform} ${userAgent}`;

  if (/iphone|ipad|ipod|mac/i.test(haystack)) return "cmd";
  if (/win/i.test(haystack)) return "win";
  return "super";
}

export function detectRuntimeMetaKeyFamily(
  protocol: "rdp" | "vnc" | "telnet",
): MetaKeyFamily {
  if (typeof navigator === "undefined") {
    return detectMetaKeyFamily(protocol);
  }
  const uaData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return detectMetaKeyFamily(protocol, {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    userAgentDataPlatform: uaData.userAgentData?.platform,
  });
}

export function metaKeyLabels(family: MetaKeyFamily): MetaKeyLabels {
  if (family === "cmd") {
    return {
      family,
      short: "Cmd",
      lock: "Cmd+L",
      stickyKey: "remoteDesktop.toolbar.cmd",
      keyTooltip: "remoteDesktop.toolbar.cmdKey",
      lockTooltip: "remoteDesktop.toolbar.cmdL",
    };
  }
  if (family === "super") {
    return {
      family,
      short: "Super",
      lock: "Super+L",
      stickyKey: "remoteDesktop.toolbar.super",
      keyTooltip: "remoteDesktop.toolbar.superKey",
      lockTooltip: "remoteDesktop.toolbar.superL",
    };
  }
  return {
    family,
    short: "Win",
    lock: "Win+L",
    stickyKey: "remoteDesktop.toolbar.win",
    keyTooltip: "remoteDesktop.toolbar.winKey",
    lockTooltip: "remoteDesktop.toolbar.winL",
  };
}
