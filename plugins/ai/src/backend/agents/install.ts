import type { Router } from "express";
import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { forwardingScript } from "./forwarding.js";
import { AGENTS, shellQuote, type AgentKind } from "./types.js";

export const PACKAGES: Record<AgentKind, string> = {
  pi: "@earendil-works/pi-coding-agent",
  opencode: "opencode-ai",
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
};

// No caller-supplied commands, versions, registries, or download URLs.
export function installScript(agent: AgentKind): string {
  if (!AGENTS.includes(agent)) throw Error("Unsupported agent");
  return `set -eu
umask 077
agent=${shellQuote(agent)}
package=${shellQuote(PACKAGES[agent])}
root="$HOME/.local/share/termix-agent-runtime"
mkdir -p "$root"
lock="$root/install.lock"
mkdir "$lock" 2>/dev/null || { echo 'Another installation is running'; exit 1; }
stage=$(mktemp -d "$root/staging.XXXXXX")
trap 'rm -rf "$stage"; rmdir "$lock"' EXIT
trap 'exit 130' HUP INT TERM
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=darwin;; *) echo 'Only Linux and macOS are supported'; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Only x64 and arm64 are supported'; exit 1;; esac
for tool in curl tar; do command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool"; exit 1; }; done
fetch() { curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-redirs 0 --connect-timeout 20 --max-time 300 "$1" -o "$2"; }
echo "Detected $platform / $arch; installing for $(id -un)"
if [ ! -x "$root/node/bin/node" ]; then
  echo 'Downloading Node.js 24 LTS from https://nodejs.org'
  fetch https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$stage/SHASUMS256.txt"
  artifact=$(awk -v suffix="-$platform-$arch.tar.gz" '$2 ~ (suffix "$") {print $2}' "$stage/SHASUMS256.txt")
  printf '%s' "$artifact" | grep -Eq '^node-v24\\.[0-9]+\\.[0-9]+-(linux|darwin)-(x64|arm64)\\.tar\\.gz$' || { echo 'Invalid official Node.js manifest'; exit 1; }
  fetch "https://nodejs.org/dist/latest-v24.x/$artifact" "$stage/$artifact"
  expected=$(awk -v file="$artifact" '$2 == file {print $1}' "$stage/SHASUMS256.txt")
  if command -v sha256sum >/dev/null; then actual=$(sha256sum "$stage/$artifact" | awk '{print $1}'); else actual=$(shasum -a 256 "$stage/$artifact" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { echo 'Node.js SHA-256 verification failed'; exit 1; }
  mkdir "$stage/node"
  tar -xzf "$stage/$artifact" -C "$stage/node" --strip-components=1
  "$stage/node/bin/node" --version
  mv "$stage/node" "$root/node"
  echo 'Node.js SHA-256 verified'
fi
PATH="$root/node/bin:$PATH"
export PATH
touch "$stage/user.npmrc" "$stage/global.npmrc"
mkdir "$stage/package"
printf '{"name":"termix-agent-runtime","version":"1.0.0","private":true}' > "$stage/package/package.json"
# Ignore host npmrc, scoped registry overrides and lifecycle download scripts.
npm_official() { env -i HOME="$HOME" PATH="$PATH" npm_config_userconfig="$stage/user.npmrc" npm_config_globalconfig="$stage/global.npmrc" npm_config_registry=https://registry.npmjs.org npm_config_strict_ssl=true npm_config_update_notifier=false npm_config_cache="$root/npm-cache" npm "$@"; }
cd "$stage/package"
echo "Resolving $package from https://registry.npmjs.org"
npm_official install --package-lock-only --ignore-scripts --no-audit --no-fund --save-exact "$package@latest"
node - <<'VERIFY'
const fs=require('fs');
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
(async () => {
  for(const [name,p] of Object.entries(lock.packages)) {
    if(!name) continue;
    const u=new URL(p.resolved);
    if(u.origin!=='https://registry.npmjs.org' || u.username || u.password) throw Error('Non-official dependency: '+name);
    if(!/^sha512-/.test(p.integrity||'')) {
      const packageName=p.name || name.split('node_modules/').pop();
      const response=await fetch('https://registry.npmjs.org/'+encodeURIComponent(packageName)+'/'+encodeURIComponent(p.version),{redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!response.ok) throw Error('Unable to verify dependency: '+name);
      const metadata=await response.json();
      if(metadata.dist?.tarball!==p.resolved || !/^sha512-/.test(metadata.dist?.integrity||'')) throw Error('Unverified dependency: '+name);
      p.integrity=metadata.dist.integrity;
    }
  }
  fs.writeFileSync('package-lock.json',JSON.stringify(lock,null,2));
  console.log('All package sources and integrity hashes verified');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
VERIFY
npm_official ci --ignore-scripts --no-audit --no-fund
# Link verified optional platform binaries without running download-capable postinstall scripts.
case "$agent" in
  claude) relative="@anthropic-ai/claude-code-$platform-$arch/claude";;
  opencode)
    variant="opencode-$platform-$arch"
    if [ "$arch" = x64 ]; then variant="$variant-baseline"; fi
    relative="$variant/bin/opencode";;
  *) relative=;;
esac
if [ -n "$relative" ]; then
  binary="$stage/package/node_modules/$relative"
  [ -x "$binary" ] || { echo 'Official platform binary is unavailable'; exit 1; }
  mkdir -p "$stage/package/node_modules/.bin"
  # Relative links remain valid when the verified package directory is activated.
  ln -sf "../$relative" "$stage/package/node_modules/.bin/$agent"
fi
"$stage/package/node_modules/.bin/$agent" --version
mkdir -p "$root/agents"
old="$root/agents/$agent.previous"
rm -rf "$old"
if [ -d "$root/agents/$agent" ]; then mv "$root/agents/$agent" "$old"; fi
if ! mv "$stage/package" "$root/agents/$agent"; then
  if [ -d "$old" ]; then mv "$old" "$root/agents/$agent"; fi
  exit 1
fi
echo "Installed $agent from the official npm registry"
echo "Executable: $root/agents/$agent/node_modules/.bin/$agent"
`;
}

export function registerInstallRoute(
  router: Router,
  ctx: PluginContext,
  isRunning: (hostId: number) => boolean,
) {
  const active = new Set<number>();
  for (const operation of ["install", "forwarding"] as const)
    router.post(`/agents/${operation}`, async (req, res) => {
      const { hostId, agent } = req.body ?? {};
      if (
        !Number.isSafeInteger(hostId) ||
        hostId < 1 ||
        (operation === "install" && !AGENTS.includes(agent))
      ) {
        res.status(400).json({ error: "Choose a host and supported agent" });
        return;
      }
      let dispose: (() => void) | undefined;
      let channel: ClientChannel | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let acquired = false;
      const write = (data: object) => {
        if (!res.destroyed) res.write(JSON.stringify(data) + "\n");
      };
      try {
        if (!(await ctx.hosts.checkAccess(hostId, "connect")).hasAccess)
          throw Error("SSH access is required");
        if (isRunning(hostId))
          throw Error(
            "Stop active agents on this host before changing its runtime or SSH policy",
          );
        if (active.has(hostId))
          throw Error(
            "Another agent setup operation is already running on this host",
          );
        active.add(hostId);
        acquired = true;
        const connection = await ctx.ssh.connect<Client>(hostId, {
          purpose: `ai-agent-${operation}`,
          profile: "session",
          timeoutMs: 15000,
        });
        dispose = connection.dispose;
        if (res.destroyed) throw Error("Agent setup request disconnected");
        channel = await new Promise<ClientChannel>((resolve, reject) =>
          connection.client.exec(
            "sh -lc " +
              shellQuote(
                operation === "install"
                  ? installScript(agent)
                  : forwardingScript(),
              ),
            (err, ch) => (err ? reject(err) : resolve(ch)),
          ),
        );
        if (res.destroyed) throw Error("Agent setup request disconnected");
        res.set({
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.once("close", () => {
          channel?.signal("TERM");
          dispose?.();
        });
        let bytes = 0;
        const log = (data: Buffer) => {
          bytes += data.length;
          if (bytes <= 256 * 1024) write({ log: data.toString() });
        };
        channel.on("data", log);
        channel.stderr.on("data", log);
        const exitCode = await new Promise<number>((resolve, reject) => {
          timer = setTimeout(
            () => reject(Error("Agent setup timed out after 10 minutes")),
            600000,
          );
          channel!.once("error", reject);
          channel!.once("close", (code: number) => resolve(code ?? -1));
        });
        if (operation === "forwarding" && exitCode === 0) {
          const verification = await ctx.ssh.connect<Client>(hostId, {
            purpose: "ai-agent-forwarding-verify",
            profile: "session",
            timeoutMs: 15000,
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const deadline = setTimeout(
                () => reject(Error("SSH forwarding verification timed out")),
                15000,
              );
              verification.client.forwardIn("127.0.0.1", 0, (error) => {
                clearTimeout(deadline);
                return error
                  ? reject(
                      Error(
                        "SSH configuration was checked, but a new connection still refused remote forwarding. Check authorized_keys restrictions and the active SSH server configuration.",
                      ),
                    )
                  : resolve();
              });
            });
            write({
              log: "Verified loopback remote forwarding on a new SSH connection\n",
            });
          } finally {
            verification.dispose();
          }
        }
        await ctx.audit.record({
          action: `agent_${operation}`,
          resourceId: String(hostId),
          success: exitCode === 0,
          details: JSON.stringify({
            agent: operation === "install" ? agent : undefined,
            package:
              operation === "install"
                ? PACKAGES[agent as AgentKind]
                : undefined,
            exitCode,
          }),
        });
        write({ done: true, success: exitCode === 0 });
        res.end();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Agent setup failed";
        if (res.headersSent) {
          write({ done: true, success: false, error: message });
          res.end();
        } else res.status(400).json({ error: message });
      } finally {
        clearTimeout(timer);
        channel?.signal("TERM");
        dispose?.();
        if (acquired) active.delete(hostId);
      }
    });
}
