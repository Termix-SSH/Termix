function resolveLocalShell(platform, requestedShell, env = process.env) {
  if (platform === "win32") {
    if (requestedShell === "wsl") {
      return { file: "wsl.exe", args: [] };
    }
    return {
      file: env.TERMIX_LOCAL_SHELL || "powershell.exe",
      args: ["-NoLogo"],
    };
  }

  return {
    file:
      env.TERMIX_LOCAL_SHELL ||
      env.SHELL ||
      (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l"],
  };
}

module.exports = { resolveLocalShell };
