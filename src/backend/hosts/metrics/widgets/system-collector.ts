import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  type HostPlatform,
} from "./common-utils.js";

async function collectWindowsSystemMetrics(client: Client): Promise<{
  hostname: string | null;
  kernel: string | null;
  os: string | null;
}> {
  let hostname: string | null = null;
  let kernel: string | null = null;
  let os: string | null = null;

  try {
    const { stdout } = await execPowerShell(
      client,
      "$os=Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{hostname=$env:COMPUTERNAME; kernel=[System.Environment]::OSVersion.Version.ToString(); os=$os.Caption} | ConvertTo-Json -Compress",
    );
    const parsed = JSON.parse(stdout.trim());
    hostname = parsed?.hostname ? String(parsed.hostname) : null;
    kernel = parsed?.kernel ? String(parsed.kernel) : null;
    os = parsed?.os ? String(parsed.os).trim() : null;
  } catch {
    // expected
  }

  return { hostname, kernel, os };
}

export async function collectSystemMetrics(
  client: Client,
  platform?: HostPlatform,
): Promise<{
  hostname: string | null;
  kernel: string | null;
  os: string | null;
}> {
  if (platform === "windows") {
    return collectWindowsSystemMetrics(client);
  }

  let hostname: string | null = null;
  let kernel: string | null = null;
  let os: string | null = null;

  try {
    const hostnameOut = await execCommand(client, "hostname");
    const kernelOut = await execCommand(client, "uname -r");
    const osOut = await execCommand(
      client,
      "command -v sw_vers >/dev/null 2>&1 && echo \"$(sw_vers -productName) $(sw_vers -productVersion)\" || (cat /etc/os-release 2>/dev/null | grep '^PRETTY_NAME=' | cut -d'\"' -f2)",
    );

    hostname = hostnameOut.stdout.trim() || null;
    kernel = kernelOut.stdout.trim() || null;
    os = osOut.stdout.trim() || null;
  } catch {
    // expected
  }

  return {
    hostname,
    kernel,
    os,
  };
}
