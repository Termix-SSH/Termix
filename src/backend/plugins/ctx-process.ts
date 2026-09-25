/**
 * ctx.process: programs on the Termix server, behind process:spawn.
 *
 * run starts a program without a shell and kills it on deactivate.
 * ensureBinary gives a plugin a verified executable pinned to one SHA-256:
 * a prebuilt copy (baked into the Docker image), the copy it downloaded
 * before, or a fresh download.
 */

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  PluginBinarySpec,
  PluginProcess,
  PluginProcessHandle,
} from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { assertCapability } from "./permissions.js";
import { getPluginDataDir } from "./paths.js";
import type { DisposableBag } from "./disposables.js";

type AuditFn = (
  action: string,
  details: string,
  outcome: { success: boolean; errorMessage?: string },
) => Promise<void>;

interface Deps {
  manifest: PluginManifest;
  bag: DisposableBag;
  audit: AuditFn;
  /** Where downloaded binaries go. Defaults to <DATA_DIR>/plugin-data/<id>/bin. */
  binDir?: () => string;
  /** Test seam for the download. */
  fetch?: typeof fetch;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

async function sha256Of(file: string): Promise<string | null> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("hex");
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginProcess(deps: Deps): PluginProcess {
  const pluginId = deps.manifest.id;
  const declared = deps.manifest.capabilities;
  const binDir =
    deps.binDir ?? (() => path.join(getPluginDataDir(pluginId), "bin"));
  const doFetch = deps.fetch ?? fetch;

  const audited = async <T>(
    action: string,
    details: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    try {
      await assertCapability(pluginId, "process:spawn", declared);
      const result = await fn();
      await deps.audit(action, details, { success: true });
      return result;
    } catch (error) {
      await deps.audit(action, details, {
        success: false,
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  };

  const run: PluginProcess["run"] = (file, args, options = {}) =>
    audited("process_run", `ran ${path.basename(String(file))}`, async () => {
      const child = spawn(file, [...args], {
        cwd: options.cwd,
        env: { ...baseEnvironment(), ...(options.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let running = true;
      const kill = (signal: "SIGTERM" | "SIGKILL" = "SIGTERM") => {
        if (!running) return;
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      };
      const untrack = deps.bag.add(
        () => kill("SIGKILL"),
        `process ${path.basename(file)}`,
      );

      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => kill("SIGKILL"), options.timeoutMs)
          : null;
      timer?.unref();

      const exited = new Promise<{
        code: number | null;
        signal: string | null;
      }>((resolve, reject) => {
        child.once("error", (error) => {
          running = false;
          if (timer) clearTimeout(timer);
          untrack();
          reject(error);
        });
        child.once("close", (code, signal) => {
          running = false;
          if (timer) clearTimeout(timer);
          untrack();
          resolve({ code, signal });
        });
      });
      // A caller that never awaits exited must not see an unhandled rejection.
      exited.catch(() => {});

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      const handle: PluginProcessHandle = {
        pid: child.pid,
        onStdout: (listener) => {
          child.stdout?.on("data", listener);
        },
        onStderr: (listener) => {
          child.stderr?.on("data", listener);
        },
        exited,
        kill,
      };
      return handle;
    });

  const download = async (
    spec: PluginBinarySpec,
    target: string,
  ): Promise<void> => {
    await assertCapability(pluginId, "network:outbound", declared);
    const url = new URL(spec.url);
    if (url.protocol !== "https:") {
      throw new Error("Binary downloads must use https");
    }
    const response = await doFetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Termix" },
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(data).digest("hex");
    if (actual !== spec.sha256.toLowerCase()) {
      throw new Error(
        `Checksum mismatch for ${spec.name}: expected ${spec.sha256}, got ${actual}`,
      );
    }
    const temp = `${target}.download-${randomUUID()}`;
    await fs.writeFile(temp, data, { mode: 0o755 });
    await fs.rename(temp, target);
  };

  const ensureBinary: PluginProcess["ensureBinary"] = (spec) =>
    audited(
      "process_ensure_binary",
      `${spec.name} ${spec.version}`,
      async () => {
        if (!SAFE_NAME.test(spec.name)) {
          throw new Error(`Invalid binary name "${spec.name}"`);
        }
        const expected = spec.sha256.toLowerCase();
        if (!SHA256_PATTERN.test(expected)) {
          throw new Error(`Invalid SHA-256 for ${spec.name}`);
        }

        for (const candidate of spec.prebuilt ?? []) {
          if ((await sha256Of(candidate)) === expected) return candidate;
        }

        const dir = binDir();
        await fs.mkdir(dir, { recursive: true });
        const target = path.join(dir, spec.name);
        if ((await sha256Of(target)) === expected) return target;

        await download(spec, target);
        return target;
      },
    );

  return { run, ensureBinary };
}

/**
 * What a plugin's program inherits from the server: enough to find binaries,
 * a home and temp folder, the locale and the outbound proxy. Never the rest,
 * which holds the JWT secret, database keys and OIDC client secrets.
 */
const INHERITED_ENV = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "TMP",
  "TEMP",
  "TMPDIR",
  "SystemRoot",
  "windir",
  "ComSpec",
  "LANG",
  "LC_ALL",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
];

export function baseEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    if (env[name] !== undefined) inherited[name] = env[name];
  }
  return inherited;
}
