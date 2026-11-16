/**
 * ctx.files.readEnvFile: a plugin reads a file an admin named in one of its
 * manifest's env variables marked `file: true`, such as a hosts file mounted
 * into the container. Core reads it, because a plugin process can only read
 * its own folders. Never a file inside the data dir or one of core's own key
 * and certificate files.
 */
import fs from "node:fs";
import path from "node:path";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { isPassableEnv } from "./sandbox/launcher/policy.js";

export const MAX_ENV_FILE_BYTES = 5 * 1024 * 1024;

/** Variables core reads its own secret files from. */
const CORE_FILE_ENV = [
  "ENCRYPTION_KEY_FILE",
  "ENCRYPTION_KEY_PREVIOUS_FILE",
  "JWT_SECRET_FILE",
  "SSL_KEY_PATH",
  "SSL_CERT_PATH",
];

export class EnvFileError extends Error {
  readonly status = 403;
  constructor(
    message: string,
    readonly code = "ENV_FILE_REFUSED",
  ) {
    super(message);
  }
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function real(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

export async function readPluginEnvFile(
  manifest: Pick<PluginManifest, "id" | "env">,
  name: string,
  source: NodeJS.ProcessEnv = process.env,
): Promise<{ text: string; modifiedMs: number } | null> {
  const entry = (manifest.env ?? []).find((item) => item?.name === name);
  if (!entry || (entry as { file?: unknown }).file !== true) {
    throw new EnvFileError(
      `${name} is not an env variable this plugin lists with "file": true`,
    );
  }
  if (!isPassableEnv(name) || CORE_FILE_ENV.includes(name)) {
    throw new EnvFileError(`${name} is one of Termix's own variables`);
  }
  const value = source[name];
  if (typeof value !== "string" || !value.trim()) return null;
  if (!path.isAbsolute(value)) {
    throw new EnvFileError(`${name} must be an absolute path`);
  }
  let target: string;
  try {
    target = await fs.promises.realpath(value);
  } catch {
    throw new EnvFileError(
      `${name} names a file that does not exist`,
      "ENOENT",
    );
  }
  assertNotCoreFile(target, source, name);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new EnvFileError(`${name} is not a file`);
  if (stat.size > MAX_ENV_FILE_BYTES) {
    throw new EnvFileError(`${name} is larger than 5 MB`);
  }
  return {
    text: await fs.promises.readFile(target, "utf8"),
    modifiedMs: Math.round(stat.mtimeMs),
  };
}

export const MAX_SECRET_BYTES = 64 * 1024;

/**
 * ctx.files.readSecret (config:secrets): a secret a config file points at,
 * from the server's environment or a file such as a Docker secret. Never one
 * of core's variables or files, or anything in the data folder.
 */
export async function readConfigSecret(
  ref: unknown,
  source: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const value = (ref ?? {}) as { env?: unknown; file?: unknown };
  if (typeof value.env === "string") {
    const name = value.env;
    if (!isPassableEnv(name) || CORE_FILE_ENV.includes(name)) {
      throw new EnvFileError(`${name} is one of Termix's own variables`);
    }
    const found = source[name];
    if (typeof found !== "string") return null;
    if (Buffer.byteLength(found) > MAX_SECRET_BYTES) {
      throw new EnvFileError(`${name} is larger than 64 KiB`);
    }
    return found;
  }
  if (typeof value.file !== "string") {
    throw new EnvFileError("A secret is { env: NAME } or { file: path }");
  }
  if (!path.isAbsolute(value.file)) {
    throw new EnvFileError("A secret file must be an absolute path");
  }
  let target: string;
  try {
    target = await fs.promises.realpath(value.file);
  } catch {
    return null;
  }
  assertNotCoreFile(target, source, value.file);
  const stat = await fs.promises.stat(target);
  if (!stat.isFile()) throw new EnvFileError(`${value.file} is not a file`);
  if (stat.size > MAX_SECRET_BYTES) {
    throw new EnvFileError(`${value.file} is larger than 64 KiB`);
  }
  return fs.promises.readFile(target, "utf8");
}

function assertNotCoreFile(
  target: string,
  source: NodeJS.ProcessEnv,
  label: string,
): void {
  if (inside(real(source.DATA_DIR || "./db/data"), target)) {
    throw new EnvFileError(`${label} may not point inside the data folder`);
  }
  for (const key of CORE_FILE_ENV) {
    const own = source[key];
    if (own && real(own) === target) {
      throw new EnvFileError(`${label} points at one of Termix's own files`);
    }
  }
}
