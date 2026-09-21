/**
 * SSH Terminal - first-party, in-process plugin.
 *
 * This plugin runs on the main thread rather than in a worker, because it IS
 * the SSH transport rather than a consumer of one: it owns a WebSocket server
 * and long-lived ssh2 clients, and neither a live socket nor an ssh2 Client can
 * cross the structured-clone postMessage boundary a worker plugin talks over.
 * See src/backend/plugins/first-party.ts for why that tier is a hardcoded
 * allowlist and not something a manifest can ask for.
 *
 * The terminal's implementation stays in core (src/backend/hosts/terminal/)
 * rather than being copied in here. Two reasons:
 *   - session-manager has six consumers outside the terminal (terminal routes,
 *     open-tabs, user-image-storage, collab, and session-sharing twice), so it
 *     is shared infrastructure, not plugin-private code.
 *   - the terminal needs plaintext host credentials to connect, which ctx.hosts
 *     deliberately never returns (PluginHostView is a 13-field allowlist that
 *     excludes password, key and passphrase).
 *
 * What this plugin owns is the lifecycle: enabling it starts the WS server,
 * disabling it closes live sessions and frees the port.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the compiled core terminal module.
 *
 * The plugin ships beside dist/backend, so in a built server the module is at
 * dist/backend/backend/hosts/terminal/index.js. Under vitest and dev the
 * plugin is loaded from the repo instead, where the source .ts is the thing
 * that exists and tsx is already handling it.
 */
async function loadTerminalModule() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);

  const candidates = [
    // Built: plugins/ssh-terminal/backend -> dist/backend/backend/...
    path.resolve(here, "../../../backend/backend/hosts/terminal/index.js"),
    // Repo layout, compiled output present.
    path.resolve(here, "../../../dist/backend/backend/hosts/terminal/index.js"),
    // Repo layout, running from source under tsx.
    path.resolve(here, "../../../src/backend/hosts/terminal/index.ts"),
  ];

  for (const candidate of candidates) {
    try {
      require.resolve(candidate);
    } catch {
      continue;
    }
    return import(new URL(`file://${candidate.replace(/\\/g, "/")}`).href);
  }

  throw new Error(
    `ssh-terminal could not locate the terminal module. Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

let terminal = null;

export async function activate(ctx) {
  terminal = await loadTerminalModule();

  await terminal.startTerminalServer();

  // Published so collab and session-sharing can reach live sessions without
  // importing a plugin. Revoked automatically when this plugin is disabled.
  ctx.registry.provide("terminal.sessions", terminal.sessionManager ?? null);

  ctx.log.info(
    `SSH terminal listening on ${terminal.TERMINAL_WS_PORT ?? 30002}`,
  );
}

export async function deactivate() {
  if (!terminal) return;
  await terminal.stopTerminalServer();
  terminal = null;
}
