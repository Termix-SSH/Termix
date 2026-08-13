const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function singleLine(value, maxLength = 255) {
  return String(value ?? "")
    .replace(/[\r\n\0]/g, "")
    .trim()
    .slice(0, maxLength);
}

function validateNativeRdpOptions(options) {
  const host = singleLine(options?.host);
  const port = Number(options?.port ?? 3389);
  if (!host || host.length > 253 || /[\\/]/.test(host)) {
    throw new Error("Invalid RDP host");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid RDP port");
  }
  return {
    host,
    port,
    username: singleLine(options?.username),
    domain: singleLine(options?.domain),
  };
}

function buildRdpFile(options) {
  const { host, port, username, domain } =
    validateNativeRdpOptions(options);
  const address = host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
  const qualifiedUsername = username
    ? domain
      ? `${domain}\\${username}`
      : username
    : "";
  return [
    `full address:s:${address}`,
    "prompt for credentials:i:1",
    "administrative session:i:0",
    ...(qualifiedUsername ? [`username:s:${qualifiedUsername}`] : []),
    "",
  ].join("\r\n");
}

async function launchNativeRdp(options, platform = process.platform) {
  if (platform !== "win32") {
    return { success: false, error: "Windows Remote Desktop is only available on Windows" };
  }

  const rdpContent = buildRdpFile(options);
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "termix-rdp-"));
  const rdpPath = path.join(tempDir, "connection.rdp");
  await fs.promises.writeFile(rdpPath, rdpContent, { encoding: "utf8", mode: 0o600 });

  return new Promise((resolve) => {
    const child = spawn("mstsc.exe", [rdpPath], {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    const cleanup = () =>
      fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    child.once("error", (error) => {
      cleanup();
      resolve({ success: false, error: error.message });
    });
    child.once("spawn", () => {
      child.unref();
      setTimeout(cleanup, 30_000).unref();
      resolve({ success: true });
    });
  });
}

module.exports = { buildRdpFile, launchNativeRdp, validateNativeRdpOptions };
