const fs = require("node:fs");
const path = require("node:path");

function isUsableShell(file, exists) {
  return !!file && (!path.isAbsolute(file) || exists(file));
}

function resolveLocalShell(
  platform,
  requestedShell,
  env = process.env,
  exists = fs.existsSync,
) {
  if (platform === "win32") {
    if (requestedShell === "wsl") {
      return { file: "wsl.exe", args: [] };
    }
    return {
      file: env.TERMIX_LOCAL_SHELL || "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  // A SHELL left pointing at an uninstalled shell makes the spawn fail.
  const fallbacks =
    platform === "darwin"
      ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
      : ["/bin/bash", "/bin/sh"];
  const file =
    [env.TERMIX_LOCAL_SHELL, env.SHELL, ...fallbacks].find((candidate) =>
      isUsableShell(candidate, exists),
    ) || fallbacks[0];
  return { file, args: ["-l"] };
}

/**
 * node-pty starts every shell through its spawn-helper binary, and a packaged
 * copy that lost its execute bit fails with "posix_spawnp failed". Returns
 * how many helpers were fixed.
 */
function repairSpawnHelpers(ptyDir, fsImpl = fs) {
  const dir = ptyDir.replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
  const candidates = [
    path.join(dir, "build", "Release", "spawn-helper"),
    path.join(
      dir,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "spawn-helper",
    ),
  ];
  let fixed = 0;
  for (const helper of candidates) {
    try {
      const mode = fsImpl.statSync(helper).mode;
      if ((mode & 0o111) === 0) {
        fsImpl.chmodSync(helper, mode | 0o755);
        fixed += 1;
      }
    } catch {
      // Missing or read-only; nothing to fix here.
    }
  }
  return fixed;
}

module.exports = { resolveLocalShell, repairSpawnHelpers };
