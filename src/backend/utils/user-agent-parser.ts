import type { Request } from "express";

export type DeviceType = "web" | "desktop" | "mobile";

export interface DeviceInfo {
  type: DeviceType;
  browser: string;
  version: string;
  os: string;
  deviceInfo: string; // Formatted string like "Chrome 120 on Windows 11"
}

/**
 * Detect the platform type based on request headers
 */
export function detectPlatform(req: Request): DeviceType {
  const userAgent = req.headers["user-agent"] || "";
  const electronHeader = req.headers["x-electron-app"];

  // Electron app detection
  if (electronHeader === "true") {
    return "desktop";
  }

  // Mobile app detection
  if (userAgent.includes("Termix-Mobile")) {
    return "mobile";
  }

  // Default to web
  return "web";
}

/**
 * Parse User-Agent string to extract device information
 */
export function parseUserAgent(req: Request): DeviceInfo {
  const userAgent = req.headers["user-agent"] || "Unknown";
  const platform = detectPlatform(req);

  // For Electron
  if (platform === "desktop") {
    return parseElectronUserAgent(userAgent);
  }

  // For Mobile app
  if (platform === "mobile") {
    return parseMobileUserAgent(userAgent);
  }

  // For web browsers
  return parseWebUserAgent(userAgent);
}

/**
 * Parse Electron app user agent
 */
function parseElectronUserAgent(userAgent: string): DeviceInfo {
  let os = "Unknown OS";
  let version = "Unknown";

  // Detect OS
  if (userAgent.includes("Windows")) {
    os = parseWindowsVersion(userAgent);
  } else if (userAgent.includes("Mac OS X")) {
    os = parseMacVersion(userAgent);
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
  }

  // Try to extract Electron version
  const electronMatch = userAgent.match(/Electron\/([\d.]+)/);
  if (electronMatch) {
    version = electronMatch[1];
  }

  return {
    type: "desktop",
    browser: "Electron",
    version,
    os,
    deviceInfo: `Termix Desktop on ${os}`,
  };
}

/**
 * Parse mobile app user agent
 */
function parseMobileUserAgent(userAgent: string): DeviceInfo {
  let os = "Unknown OS";
  let version = "Unknown";

  // Check for Termix-Mobile/Platform format first (e.g., "Termix-Mobile/Android" or "Termix-Mobile/iOS")
  const termixPlatformMatch = userAgent.match(/Termix-Mobile\/(Android|iOS)/i);
  if (termixPlatformMatch) {
    const platform = termixPlatformMatch[1];
    if (platform.toLowerCase() === "android") {
      // Try to get Android version from full UA string
      const androidMatch = userAgent.match(/Android ([\d.]+)/);
      os = androidMatch ? `Android ${androidMatch[1]}` : "Android";
    } else if (platform.toLowerCase() === "ios") {
      // Try to get iOS version from full UA string
      const iosMatch = userAgent.match(/OS ([\d_]+)/);
      if (iosMatch) {
        const iosVersion = iosMatch[1].replace(/_/g, ".");
        os = `iOS ${iosVersion}`;
      } else {
        os = "iOS";
      }
    }
  } else {
    // Fallback: Check for standard Android/iOS patterns in the user agent
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

  // Try to extract app version (if included in UA)
  // Match patterns like "Termix-Mobile/1.0.0" or just "Termix-Mobile"
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

/**
 * Parse web browser user agent
 */
function parseWebUserAgent(userAgent: string): DeviceInfo {
  let browser = "Unknown Browser";
  let version = "Unknown";
  let os = "Unknown OS";

  // Detect browser
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

  // Detect OS
  if (userAgent.includes("Windows")) {
    os = parseWindowsVersion(userAgent);
  } else if (userAgent.includes("Mac OS X")) {
    os = parseMacVersion(userAgent);
  } else if (userAgent.includes("Linux")) {
    os = "Linux";
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
  }

  // Shorten version to major.minor
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

/**
 * Parse Windows version from user agent
 */
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

/**
 * Parse macOS version from user agent
 */
function parseMacVersion(userAgent: string): string {
  const match = userAgent.match(/Mac OS X ([\d_]+)/);
  if (match) {
    const version = match[1].replace(/_/g, ".");
    const parts = version.split(".");
    const major = parseInt(parts[0]);
    const minor = parseInt(parts[1]);

    // macOS naming
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
