import type { Request } from "express";

export type DeviceType = "web" | "desktop" | "mobile";

export interface DeviceInfo {
  type: DeviceType;
  browser: string;
  version: string;
  os: string;
  deviceInfo: string;
}

export function detectPlatform(req: Request): DeviceType {
  const userAgent = req.headers["user-agent"] || "";
  const electronHeader = req.headers["x-electron-app"];

  if (electronHeader === "true" || userAgent.includes("Termix-Desktop")) {
    return "desktop";
  }

  if (userAgent.includes("Termix-Mobile")) {
    return "mobile";
  }

  if (userAgent.includes("Android")) {
    return "mobile";
  }

  return "web";
}

export function parseUserAgent(req: Request): DeviceInfo {
  const userAgent = req.headers["user-agent"] || "Unknown";
  const platform = detectPlatform(req);

  if (platform === "desktop") {
    return parseElectronUserAgent(userAgent);
  }

  if (platform === "mobile") {
    return parseMobileUserAgent(userAgent);
  }

  return parseWebUserAgent(userAgent);
}

function parseElectronUserAgent(userAgent: string): DeviceInfo {
  let os = "Unknown OS";
  let version = "Unknown";

  const termixMatch = userAgent.match(/Termix-Desktop\/([\d.]+)\s*\(([^;)]+)/);
  if (termixMatch) {
    version = termixMatch[1];
    os = termixMatch[2].trim();
  } else {
    if (userAgent.includes("Windows")) {
      os = parseWindowsVersion(userAgent);
    } else if (userAgent.includes("Mac OS X")) {
      os = parseMacVersion(userAgent);
    } else if (userAgent.includes("macOS")) {
      os = "macOS";
    } else if (userAgent.includes("Linux")) {
      os = "Linux";
    }

    const electronMatch = userAgent.match(/Electron\/([\d.]+)/);
    if (electronMatch) {
      version = electronMatch[1];
    }
  }

  return {
    type: "desktop",
    browser: "Termix Desktop",
    version,
    os,
    deviceInfo: `Termix Desktop on ${os}`,
  };
}

function parseMobileUserAgent(userAgent: string): DeviceInfo {
  let os = "Unknown OS";
  let version = "Unknown";

  const termixPlatformMatch = userAgent.match(/Termix-Mobile\/(Android|iOS)/i);
  if (termixPlatformMatch) {
    const platform = termixPlatformMatch[1];
    if (platform.toLowerCase() === "android") {
      const androidMatch = userAgent.match(/Android ([\d.]+)/);
      os = androidMatch ? `Android ${androidMatch[1]}` : "Android";
    } else if (platform.toLowerCase() === "ios") {
      const iosMatch = userAgent.match(/OS ([\d_]+)/);
      if (iosMatch) {
        const iosVersion = iosMatch[1].replace(/_/g, ".");
        os = `iOS ${iosVersion}`;
      } else {
        os = "iOS";
      }
    }
  } else {
    if (userAgent.includes("Android")) {
      const androidMatch = userAgent.match(/Android ([\d.]+)/);
      os = androidMatch ? `Android ${androidMatch[1]}` : "Android";
    } else if (
      userAgent.includes("iOS") ||
      userAgent.includes("iPhone") ||
      userAgent.includes("iPad")
    ) {
      const iosMatch = userAgent.match(/OS ([\d_]+)/);
      if (iosMatch) {
        const iosVersion = iosMatch[1].replace(/_/g, ".");
        os = `iOS ${iosVersion}`;
      } else {
        os = "iOS";
      }
    }
  }

  const versionMatch = userAgent.match(
    /Termix-Mobile\/(?:Android|iOS|)([\d.]+)/i,
  );
  if (versionMatch) {
    version = versionMatch[1];
  }

  return {
    type: "mobile",
    browser: "Termix Mobile",
    version,
    os,
    deviceInfo: `Termix Mobile on ${os}`,
  };
}

function parseWebUserAgent(userAgent: string): DeviceInfo {
  let browser = "Unknown Browser";
  let version = "Unknown";
  let os = "Unknown OS";

  if (userAgent.includes("Edg/")) {
    const match = userAgent.match(/Edg\/([\d.]+)/);
    browser = "Edge";
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Chrome/") && !userAgent.includes("Edg")) {
    const match = userAgent.match(/Chrome\/([\d.]+)/);
    browser = "Chrome";
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Firefox/")) {
    const match = userAgent.match(/Firefox\/([\d.]+)/);
    browser = "Firefox";
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Safari/") && !userAgent.includes("Chrome")) {
    const match = userAgent.match(/Version\/([\d.]+)/);
    browser = "Safari";
    version = match ? match[1] : "Unknown";
  } else if (userAgent.includes("Opera/") || userAgent.includes("OPR/")) {
    const match = userAgent.match(/(?:Opera|OPR)\/([\d.]+)/);
    browser = "Opera";
    version = match ? match[1] : "Unknown";
  }

  if (userAgent.includes("Windows")) {
    os = parseWindowsVersion(userAgent);
  } else if (userAgent.includes("Android")) {
    const match = userAgent.match(/Android ([\d.]+)/);
    os = match ? `Android ${match[1]}` : "Android";
  } else if (
    userAgent.includes("iOS") ||
    userAgent.includes("iPhone") ||
    userAgent.includes("iPad")
  ) {
    const match = userAgent.match(/OS ([\d_]+)/);
    if (match) {
      const iosVersion = match[1].replace(/_/g, ".");
      os = `iOS ${iosVersion}`;
    } else {
      os = "iOS";
    }
  } else if (userAgent.includes("Mac OS X")) {
    os = parseMacVersion(userAgent);
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
  }

  if (version !== "Unknown") {
    const versionParts = version.split(".");
    version = versionParts.slice(0, 2).join(".");
  }

  return {
    type: "web",
    browser,
    version,
    os,
    deviceInfo: `${browser} ${version} on ${os}`,
  };
}

function parseWindowsVersion(userAgent: string): string {
  if (userAgent.includes("Windows NT 10.0")) {
    return "Windows 10/11";
  } else if (userAgent.includes("Windows NT 6.3")) {
    return "Windows 8.1";
  } else if (userAgent.includes("Windows NT 6.2")) {
    return "Windows 8";
  } else if (userAgent.includes("Windows NT 6.1")) {
    return "Windows 7";
  } else if (userAgent.includes("Windows NT 6.0")) {
    return "Windows Vista";
  } else if (
    userAgent.includes("Windows NT 5.1") ||
    userAgent.includes("Windows NT 5.2")
  ) {
    return "Windows XP";
  }
  return "Windows";
}

function parseMacVersion(userAgent: string): string {
  const match = userAgent.match(/Mac OS X ([\d_]+)/);
  if (match) {
    const version = match[1].replace(/_/g, ".");
    const parts = version.split(".");
    const major = parseInt(parts[0]);
    const minor = parseInt(parts[1]);

    if (major === 10) {
      if (minor >= 15) return `macOS ${major}.${minor}`;
      if (minor === 14) return "macOS Mojave";
      if (minor === 13) return "macOS High Sierra";
      if (minor === 12) return "macOS Sierra";
    } else if (major >= 11) {
      return `macOS ${major}`;
    }

    return `macOS ${version}`;
  }
  return "macOS";
}
