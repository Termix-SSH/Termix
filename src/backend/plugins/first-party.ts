/**
 * The plugins that run in-process on the main thread instead of in a worker.
 *
 * ## Why this list is hardcoded
 *
 * Every other plugin is handed a `ctx` object and nothing else, across a
 * structured-clone postMessage boundary. That boundary is what makes the
 * capability gate and the audit trail meaningful: a worker plugin physically
 * cannot hold a db handle, an ssh2 Client or a live socket, so every privileged
 * action has to pass through the broker, which checks grants first and writes
 * an audit line after.
 *
 * A plugin in this tier opts out of all of that. It is imported directly into
 * the server process, so it has the same reach as any other backend module: no
 * ctx boundary, no capability gate, no audit interception, no containment. It
 * is Termix's own code that happens to be packaged and lifecycled as a plugin.
 *
 * That is only defensible because membership cannot be claimed. This set is
 * compiled into the server. A manifest cannot opt in -- declaring the
 * capability without being listed here is a validation error, not a silent
 * downgrade (see parseManifest). Nothing read from the database, a registry or
 * a plugin directory can add to it.
 *
 * DO NOT add an installed or community plugin here. If a plugin needs more
 * reach than ctx allows, the answer is to widen ctx -- deliberately, with a
 * gate and an audit line -- not to move it onto the main thread.
 */

/**
 * The only plugin ids that may run in-process.
 *
 * ssh-terminal is here because it IS the SSH transport rather than a consumer
 * of it: it owns a WebSocket server and long-lived ssh2 clients, neither of
 * which can cross a postMessage boundary.
 *
 * docker is here for the same reason: its container console owns a
 * WebSocket server with long-lived ssh2 clients and PTY streams, its
 * session manager reuses a live ssh2.Client across many REST calls, and its
 * SSH connect flow implements TOTP/Warpgate as a stateful multi-request
 * handshake the worker ctx.ssh API has no hook for.
 *
 * host-metrics is here for the same reason: its polling manager holds
 * long-lived ssh2 clients across a whole fleet of hosts, reused between
 * polling ticks rather than opened per request, and its connect flow
 * implements the same jump-host/SOCKS5/TOTP/Warpgate/OPKSSH/Vault
 * keyboard-interactive handshakes the terminal does -- none of which the
 * worker ctx.ssh API (connect + single exec-and-collect) has a hook for.
 *
 * ai is here for a different reason: it does not own a transport at all, but
 * it writes directly across hosts, snippets, fleets, alert rules and
 * automations through their repositories, runs approved commands over the
 * shared SSH pool via resolveHostById and withConnection, and streams its
 * chat replies as server-sent events. ctx.hosts is a 13-field read-only view
 * with no write methods and no snippets/fleets/alerts/automations surface at
 * all, and ctx.http.route replies with one postMessage value rather than a
 * stream, so none of that fits the worker ctx either.
 *
 * proxmox is here for the same reason as ai: it does not own a transport,
 * but it writes directly across hosts through the host repository during
 * discovery and sync, resolves and connects to hosts via resolveHostById and
 * createJumpHostChain the same way the terminal and ai's command executor
 * do, verifies host keys via SSHHostKeyVerifier, and streams its discovery
 * progress as server-sent events. Neither the worker's 13-field read-only
 * ctx.hosts nor its single-postMessage-reply ctx.http.route can support that.
 *
 * remote-desktop is here for the same reason ssh-terminal is: it owns a
 * WebSocket server (guacamole-lite, port 30008) and its
 * /connect-host/:hostId route does multi-step credential/tunnel resolution
 * (SSH jump-host tunnels, a macOS VNC compatibility proxy) using raw
 * net.Socket plumbing that cannot cross a structured-clone boundary.
 *
 * fleets is here for the same reason as ai and proxmox: it does not own a
 * transport, but its execute/transfer routes resolve and connect to many
 * hosts concurrently via resolveHostById and the shared SSH pool, stream SFTP
 * reads/writes and a zip archive for its push/pull routes, and buffer
 * multipart file uploads. None of that fits the worker's single-exec
 * ctx.ssh or single-postMessage-reply ctx.http.route.
 *
 * automations is here for the same reason as ai, proxmox and fleets: it does
 * not own a transport, but its engine and scheduler write across hosts,
 * snippets, fleets and notification-channel repositories through the shared
 * SSH pool via resolveHostById and withConnection, and its scheduler needs
 * direct repository access plus subscription to the cross-plugin event bus
 * (host metrics, status and health-check events) that the worker's read-only
 * ctx.hosts and single-postMessage-reply ctx.http.route cannot support.
 *
 * network-topology is here for a different reason than the rest of this
 * list: its two routes are plain per-user JSON CRUD against a single
 * repository, and would fit the worker ctx fine on their own. It stays
 * in-process to keep its existing /network-topology URL and its existing
 * dedicated table (network_topology, keyed by userId) rather than moving
 * onto /plugin-api/network-topology/* and the generic key-value
 * ctx.storage the worker tier would require -- a URL and storage-model
 * change, not a capability gap.
 *
 * tailscale is here because its /devices route makes an outbound HTTP call
 * to the Tailscale (or Headscale) Admin API using a settings-repo API key.
 * The worker ctx has no fetch primitive at all (ctx.fetch is notImplemented
 * in SDK v1, see worker-bootstrap.ts), so there is currently no way for a
 * worker-tier plugin to make an outbound HTTP request.
 *
 * workspaces is here for the same reason network-topology is: its routes are
 * plain per-user JSON CRUD against a single repository, and would fit the
 * worker ctx fine on their own. It stays in-process to keep its existing
 * /workspaces URL and its existing dedicated table (user_workspaces, keyed
 * by userId) rather than moving onto /plugin-api/workspaces/* and the
 * generic key-value ctx.storage the worker tier would require -- a URL and
 * storage-model change, not a capability gap.
 */
export const FIRST_PARTY_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "ssh-terminal",
  "docker",
  "host-metrics",
  "ai",
  "proxmox",
  "remote-desktop",
  "fleets",
  "automations",
  "network-topology",
  "tailscale",
  "workspaces",
]);

export const TRANSPORT_OWNER_CAPABILITY = "process:transport-owner";

export function isFirstParty(pluginId: string): boolean {
  return FIRST_PARTY_PLUGIN_IDS.has(pluginId);
}

/**
 * Both conditions are required. The allowlist alone is not enough -- a
 * first-party plugin that does not declare the capability still runs in a
 * worker, so the manifest stays an honest description of what the plugin does.
 */
export function runsInProcess(
  pluginId: string,
  permissions: readonly string[],
): boolean {
  return (
    isFirstParty(pluginId) && permissions.includes(TRANSPORT_OWNER_CAPABILITY)
  );
}
