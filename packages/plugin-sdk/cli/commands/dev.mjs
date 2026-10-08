import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { build } from "./build.mjs";
import { pack } from "./pack.mjs";
import { readManifest } from "../lib/plugin-dir.mjs";

const SOURCE_DIRS = new Set(["src", "locales", "migrations"]);
const SOURCE_FILES = new Set(["manifest.json", "package.json", "README.md"]);

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} needs a value`);
  return value;
}

/** True when a changed path (relative to the plugin) feeds its build. */
export function isSourceChange(filename) {
  if (!filename) return false;
  const parts = String(filename).replaceAll("\\", "/").split("/");
  if (parts.length === 1) return SOURCE_FILES.has(parts[0]);
  return SOURCE_DIRS.has(parts[0]);
}

export function resolveDevOptions(args, env = process.env) {
  const server = (
    readOption(args, "--server") ??
    env.TERMIX_SERVER_URL ??
    "http://localhost:30001"
  ).replace(/\/+$/, "");
  const key = readOption(args, "--key") ?? env.TERMIX_API_KEY ?? null;
  if (!key) {
    throw new Error(
      "An admin API key is needed. Pass --key tmx_... or set TERMIX_API_KEY.",
    );
  }
  return { server, key, once: args.includes("--once") };
}

const HINTS = {
  DEVELOPER_MODE_OFF:
    "Turn on Plugin developer mode in Settings, General, then save again.",
  SIGNED_ONLY:
    "The server sets TERMIX_REQUIRE_SIGNED_PLUGINS, so it never installs unsigned files.",
  BUNDLED_ID: "That id ships with Termix. Use a different id while developing.",
  ALREADY_INSTALLED:
    "Uninstall the copy installed from the registry first, then save again.",
};

async function request(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!response.ok) {
    const code = body?.code;
    const hint = code && HINTS[code] ? `\n  ${HINTS[code]}` : "";
    throw new Error(
      `${response.status} ${body?.error ?? response.statusText}${hint}`,
    );
  }
  return body;
}

/** Uploads a packed .tmxplug and installs it, agreeing to what it asks for. */
export async function pushPlugin(
  file,
  { server, key },
  fetchImpl = globalThis.fetch,
) {
  const auth = { Authorization: `Bearer ${key}` };
  const preview = await request(fetchImpl, `${server}/plugins/upload`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/octet-stream" },
    body: fs.readFileSync(file),
  });
  const result = await request(
    fetchImpl,
    `${server}/plugins/upload/${preview.token}/install`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ capabilities: preview.capabilities }),
    },
  );
  return { preview, result };
}

/**
 * Builds, packs and installs the plugin on a running Termix server, then
 * does it again on every source change. The server needs developer mode on.
 */
export async function dev({ cwd, args = [] }) {
  const options = resolveDevOptions(args);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-plugin-dev-"));
  let lastCapabilities = null;

  const cycle = async () => {
    const started = Date.now();
    await build({ cwd });
    const file = await pack({ cwd, args: ["--out", outDir] });
    const { preview, result } = await pushPlugin(file, options);
    fs.rmSync(file, { force: true });
    const capabilities = preview.capabilities.join(", ") || "none";
    if (capabilities !== lastCapabilities) {
      console.log(`  capabilities ${capabilities}`);
      lastCapabilities = capabilities;
    }
    console.log(
      `installed ${result.id}@${result.version} on ${options.server} (${result.state}, ${Date.now() - started} ms)`,
    );
  };

  try {
    await cycle();
  } catch (error) {
    if (options.once) throw error;
    console.error(error?.message ?? error);
  }
  if (options.once) return;

  const { id } = readManifest(cwd);
  console.log(`watching ${id} for changes, Ctrl+C to stop`);
  let timer = null;
  let running = false;
  let again = false;
  const fire = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await cycle();
    } catch (error) {
      console.error(error?.message ?? error);
    } finally {
      running = false;
      if (again) {
        again = false;
        void fire();
      }
    }
  };
  fs.watch(cwd, { recursive: true }, (_event, filename) => {
    if (!isSourceChange(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void fire(), 300);
  });
  await new Promise(() => {});
}
