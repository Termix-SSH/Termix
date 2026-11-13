// Starts each plugin backend of the embedded server as its own Electron
// utility process. The app's fuses stop the backend from running Node scripts
// itself, so it asks the main process, which checks the request with the
// same rules the Docker launcher uses and hands the backend a MessagePort
// straight to the plugin. Windows and macOS get the Node permission model
// only: no per plugin user and no firewall rule.

const path = require("path");
const { pathToFileURL } = require("url");

const SANDBOX_MESSAGE = "tmx-sandbox";

function createPluginSandboxHost(deps) {
  const {
    utilityProcess,
    MessageChannelMain,
    backendDir,
    dataRoot,
    log = () => {},
    loadPolicy = () =>
      require(
        path.join(backendDir, "plugins", "sandbox", "launcher", "policy.js"),
      ),
  } = deps;
  const runtime = path.join(
    backendDir,
    "plugins",
    "sandbox",
    "child",
    "runtime.js",
  );
  const harden = path.join(
    backendDir,
    "plugins",
    "sandbox",
    "child",
    "harden.js",
  );
  const children = new Map();
  let policy = null;

  function reply(backend, message, transfer) {
    try {
      backend.postMessage(
        { type: SANDBOX_MESSAGE, ...message },
        transfer ?? [],
      );
    } catch (error) {
      log("plugin sandbox reply failed:", error.message);
    }
  }

  function spawn(backend, request) {
    const id = String(request.id ?? "");
    policy ??= loadPolicy();
    if (
      children.has(id) ||
      !policy.isPluginId(String(request.pluginId ?? ""))
    ) {
      reply(backend, { op: "error", id, message: "bad request" });
      return;
    }
    const verdict = policy.validateSpawn(request, {
      hardenUrl: pathToFileURL(harden).href,
      dataRoot,
    });
    if (!verdict.ok) {
      log("refused a plugin start:", verdict.reason);
      reply(backend, { op: "error", id, message: verdict.reason });
      return;
    }
    let child;
    try {
      require("fs").mkdirSync(String(request.dataDir), { recursive: true });
      child = utilityProcess.fork(runtime, [], {
        execArgv: request.execArgv,
        // Checked by validateSpawn: NODE_ENV, the plugin id and the
        // variables the plugin's manifest lists, never one of core's.
        env: request.env,
        stdio: "pipe",
        serviceName: `Termix plugin ${request.pluginId}`,
      });
    } catch (error) {
      reply(backend, { op: "error", id, message: error.message });
      return;
    }
    children.set(id, child);
    child.once("spawn", () => {
      const { port1, port2 } = new MessageChannelMain();
      child.postMessage({ type: SANDBOX_MESSAGE, op: "port" }, [port2]);
      reply(backend, { op: "spawned", id, pid: child.pid }, [port1]);
    });
    for (const [stream, name] of [
      [child.stdout, "out"],
      [child.stderr, "err"],
    ]) {
      let buffer = "";
      stream?.setEncoding?.("utf8");
      stream?.on("data", (chunk) => {
        buffer += String(chunk);
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (line) {
            reply(backend, {
              op: "log",
              id,
              stream: name,
              line: line.slice(0, 4000),
            });
          }
          index = buffer.indexOf("\n");
        }
        if (buffer.length > 64 * 1024) buffer = "";
      });
    }
    child.once("exit", (code) => {
      children.delete(id);
      reply(backend, {
        op: "exit",
        id,
        code: typeof code === "number" ? code : null,
      });
    });
  }

  return {
    /** True when the message was a sandbox message and was handled. */
    handle(message, backend) {
      if (!message || message.type !== SANDBOX_MESSAGE) return false;
      if (message.op === "spawn") spawn(backend, message);
      else if (message.op === "kill") children.get(String(message.id))?.kill();
      return true;
    },
    stopAll() {
      for (const child of children.values()) {
        try {
          child.kill();
        } catch {
          // already gone
        }
      }
      children.clear();
    },
  };
}

module.exports = { createPluginSandboxHost, SANDBOX_MESSAGE };
