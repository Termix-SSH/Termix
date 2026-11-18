/**
 * Turns a plugin's granted capabilities into the flags its process starts
 * with. The table itself is CAPABILITY_PROCESS_GRANTS in the SDK's
 * capabilities.ts, so the guide, the CLI and core read the same rows.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CAPABILITY_PROCESS_GRANTS } from "@termix-ssh/plugin-sdk/capabilities";

export const DEFAULT_HEAP_MB = 256;

export interface ChildFlagInput {
  /** Capabilities the plugin declares and an admin granted. */
  granted: readonly string[];
  /** Folders the process may read: the plugin, the runtime, packages. */
  readPaths: readonly string[];
  /** The plugin's own data folder. */
  dataDir: string;
  /** The preload that closes what the permission model leaves open. */
  hardenPath: string;
  heapMb?: number;
  /** The manifest's sandbox.workers: the plugin starts worker threads. */
  workers?: boolean;
  /** Major version of the Node that runs the child. */
  nodeMajor: number;
  /** Defaults to this process's platform. */
  platform?: NodeJS.Platform;
}

// node-gyp-build checks this file to pick a musl or glibc build, and under
// the permission model a refused read throws instead of saying "not there".
const ADDON_PROBE_READS = ["/etc/alpine-release"];

export interface ChildFlags {
  execArgv: string[];
  /** The process may open sockets. Only means something on Node 25+. */
  allowNet: boolean;
  writeDataDir: boolean;
  /** The firewall rule kind for the plugin's user. */
  firewall: "deny" | "allow-all";
  /** The plugin may not use sockets, so harden.js refuses them too. */
  jsNetworkFence: boolean;
}

/** Both spellings of a path: the model checks the path as asked for. */
export function withRealPaths(paths: readonly string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    out.add(path.resolve(p));
    try {
      out.add(fs.realpathSync(p));
    } catch {
      // not there in this layout
    }
  }
  return [...out];
}

export function buildChildFlags(input: ChildFlagInput): ChildFlags {
  const flags = new Set<string>();
  let writeDataDir = false;
  let firewall: "deny" | "allow-all" = "deny";
  for (const capability of input.granted) {
    const grant = CAPABILITY_PROCESS_GRANTS[capability];
    if (!grant) continue;
    for (const flag of grant.flags) flags.add(flag);
    if (grant.writeDataDir) writeDataDir = true;
    if (grant.firewall === "allow-all") firewall = "allow-all";
  }

  // harden.js makes every worker inherit these flags and load it first.
  if (input.workers === true) flags.add("--allow-worker");

  const allowNet = flags.has("--allow-net");
  // --allow-net arrived in Node 25. Older Node has no network scope at all,
  // so the flag would only stop the process from starting. harden.js refuses
  // sockets on every version: on Node 26 a denied listen throws uncaught and
  // kills the process instead of reaching the plugin.
  const jsNetworkFence = !allowNet;
  if (input.nodeMajor < 25) flags.delete("--allow-net");

  const execArgv = ["--permission"];
  // Writing its own folder is no use without reading it back.
  const reads = writeDataDir
    ? [...input.readPaths, input.dataDir]
    : [...input.readPaths];
  if (
    flags.has("--allow-addons") &&
    (input.platform ?? process.platform) === "linux"
  ) {
    reads.push(...ADDON_PROBE_READS);
  }
  for (const grant of withRealPaths(reads)) {
    execArgv.push(`--allow-fs-read=${grant}`);
  }
  if (writeDataDir) execArgv.push(`--allow-fs-write=${input.dataDir}`);
  for (const flag of [...flags].sort()) execArgv.push(flag);
  // A small young generation and a heap cap: without them each process keeps
  // the garbage from parsing its modules (drizzle alone leaves about 120 MB).
  // The cap is also the plugin's memory limit.
  execArgv.push(
    "--max-semi-space-size=1",
    `--max-old-space-size=${input.heapMb ?? DEFAULT_HEAP_MB}`,
    "--expose-gc",
    "--disable-sigusr1",
    `--import=${pathToFileURL(input.hardenPath).href}`,
  );
  return {
    execArgv,
    allowNet,
    writeDataDir,
    firewall,
    jsNetworkFence,
  };
}
