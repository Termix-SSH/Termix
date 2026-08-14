export interface DirectTransferEndpoint {
  host: string;
  port: number;
  username: string;
}

export const DIRECT_TRANSFER_MIN_IMPROVEMENT = 0.2;
export const DIRECT_TRANSFER_MIN_BYTES = 32 * 1024 * 1024;

export function shouldBenchmarkDirectTransfer(totalBytes: number): boolean {
  return totalBytes >= DIRECT_TRANSFER_MIN_BYTES;
}

export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function buildDirectSshCommand(
  endpoint: DirectTransferEndpoint,
): string {
  const target = `${endpoint.username}@${formatHost(endpoint.host)}`;
  return [
    "ssh",
    "-o BatchMode=yes",
    "-o ConnectTimeout=5",
    "-o StrictHostKeyChecking=yes",
    `-p ${endpoint.port}`,
    quoteShell(target),
  ].join(" ");
}

export function buildDirectProbeCommand(
  endpoint: DirectTransferEndpoint,
): string {
  return `${buildDirectSshCommand(endpoint)} ${quoteShell("command -v rsync >/dev/null")}`;
}

export function buildDirectRsyncCommand(
  endpoint: DirectTransferEndpoint,
  sourcePaths: string[],
  destPath: string,
  destIsDirectory: boolean,
): string {
  const sshTransport = buildDirectSshCommand(endpoint).replace(/ '[^']+'$/, "");
  const targetHost = `${endpoint.username}@${formatHost(endpoint.host)}`;
  const targetPath = destIsDirectory
    ? `${destPath.replace(/\/+$/, "") || "/"}/`
    : destPath;
  const sources = sourcePaths.map(quoteShell).join(" ");
  const target = quoteShell(`${targetHost}:${targetPath}`);

  return [
    "rsync -a --partial --append-verify --protect-args --info=progress2",
    `-e ${quoteShell(sshTransport)}`,
    "--",
    sources,
    target,
  ].join(" ");
}

export function shouldUseDirectTransfer(
  directMs: number,
  relayMs: number,
  minImprovement = DIRECT_TRANSFER_MIN_IMPROVEMENT,
): boolean {
  if (directMs <= 0 || relayMs <= 0) return false;
  return directMs <= relayMs * (1 - minImprovement);
}
