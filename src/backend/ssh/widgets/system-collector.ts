import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import { statsLogger } from "../../utils/logger.js";

export async function collectSystemMetrics(client: Client): Promise<{
  hostname: string | null;
  kernel: string | null;
  os: string | null;
}> {
  let hostname: string | null = null;
  let kernel: string | null = null;
  let os: string | null = null;

  try {
    const hostnameOut = await execCommand(client, "hostname");
    const kernelOut = await execCommand(client, "uname -r");
    const osOut = await execCommand(
      client,
      "cat /etc/os-release | grep '^PRETTY_NAME=' | cut -d'\"' -f2",
    );

    hostname = hostnameOut.stdout.trim() || null;
    kernel = kernelOut.stdout.trim() || null;
    os = osOut.stdout.trim() || null;
  } catch (e) {
    // No error log
  }

  return {
    hostname,
    kernel,
    os,
  };
}
