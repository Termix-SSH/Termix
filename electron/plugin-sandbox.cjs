// Starts each plugin backend of the embedded server. The app's fuses stop
// the backend from running Node scripts itself, and Electron's own utility
// processes ignore Node's permission flags, so main runs the pinned Node the
// app ships (the same major as the server image) inside the OS sandbox
// helper, with the same flags the Docker launcher uses. Main checks each
// request with the launcher's rules, then hands the backend a MessagePort
// that carries the child's stdio frames. Main only splits frames, it never
// decodes what a plugin sends.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SANDBOX_MESSAGE = "tmx-sandbox";

function realPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function createPluginSandboxHost(deps) {
  const {
    MessageChannelMain,
    backendDir,
    dataRoot,
    spawnProcess = require("child_process").spawn,
    getRuntime,
    platform = process.platform,
    mas = false,
    env = process.env,
    log = () => {},
    loadPolicy = () =>
      require(
        path.join(backendDir, "plugins", "sandbox", "launcher", "policy.js"),
      ),
    loadFrames = () =>
      require(path.join(backendDir, "plugins", "sandbox", "frames.js")),
  } = deps;
  const runtimeScript = path.join(
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
  let frames = null;
  let runtime = null;

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

  /**
   * What the child gets: the checked env and the few paths Windows needs
   * (an AppContainer can't start without LOCALAPPDATA).
   */
  function childEnv(requestEnv) {
    const out = { ...requestEnv };
    if (platform === "win32") {
      for (const name of ["SystemRoot", "windir", "LOCALAPPDATA"]) {
        if (env[name]) out[name] = env[name];
      }
    }
    return out;
  }

  function spawn(backend, request) {
    const id = String(request.id ?? "");
    policy ??= loadPolicy();
    frames ??= loadFrames();
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
    runtime ??= getRuntime();
    if (runtime.error) {
      log("plugin runtime:", runtime.error);
      reply(backend, { op: "error", id, message: runtime.error });
      return;
    }

    // The runtime's own folder and the package.json above it (dist/backend),
    // where Node's module type lookup stops. Without it the lookup climbs to
    // folders the fence keeps closed and fails there.
    const jailPolicy = policy.buildJailPolicy(request, [
      path.dirname(runtimeScript),
      path.resolve(backendDir, "..", "package.json"),
    ]);
    const nodeArgs = [
      ...request.execArgv,
      // An AppContainer can't read the attributes of C:\ and other parents,
      // which Node's real path walk needs. The packaged app has no links.
      ...(platform === "win32"
        ? ["--preserve-symlinks", "--preserve-symlinks-main"]
        : []),
      // Its real path: Node resolves the main script through every link on
      // the way (macOS /var is one), and reading a link needs its own grant.
      realPath(runtimeScript),
      frames.STDIO_FLAG,
    ];
    const args = [
      ...(mas ? ["--no-seatbelt"] : []),
      JSON.stringify(jailPolicy),
      "--",
      runtime.node,
      ...nodeArgs,
    ];

    let child;
    try {
      fs.mkdirSync(String(request.dataDir), { recursive: true });
      child = spawnProcess(runtime.jail, args, {
        cwd: String(request.dataDir),
        env: childEnv(request.env),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reply(backend, { op: "error", id, message: error.message });
      return;
    }
    children.set(id, child);
    let started = false;
    const { port1, port2 } = new MessageChannelMain();

    child.once("error", (error) => {
      if (started) return;
      children.delete(id);
      port1.close();
      reply(backend, { op: "error", id, message: error.message });
    });
    child.once("spawn", () => {
      started = true;
      port1.on("message", (event) => {
        try {
          child.stdin.write(frames.encodeFrame(Buffer.from(event.data)));
        } catch {
          // the child is gone; its exit is reported below
        }
      });
      port1.start();
      reply(backend, { op: "spawned", id, pid: child.pid }, [port2]);
    });
    child.stdin.on("error", () => {});

    const reader = new frames.FrameReader(
      (payload) => port1.postMessage(payload),
      (error) => {
        log(`plugin ${request.pluginId} broke its channel:`, error.message);
        child.kill();
      },
    );
    child.stdout.on("data", (chunk) => reader.push(chunk));

    let buffer = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      buffer += String(chunk);
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line) {
          reply(backend, {
            op: "log",
            id,
            stream: "err",
            line: line.slice(0, 4000),
          });
        }
        index = buffer.indexOf("\n");
      }
      if (buffer.length > 64 * 1024) buffer = "";
    });

    child.once("exit", (code, signal) => {
      children.delete(id);
      port1.close();
      if (!started) return;
      reply(backend, {
        op: "exit",
        id,
        code: typeof code === "number" ? code : null,
        signal: signal ?? null,
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
