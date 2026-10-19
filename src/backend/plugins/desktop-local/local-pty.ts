/**
 * Local shells for plugins on the desktop app's embedded backend. Ported from
 * the old Electron local terminal handlers.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { PluginLocalPty } from "@termix-ssh/plugin-sdk/backend";

export function resolveLocalShell(
  platform: NodeJS.Platform,
  requestedShell?: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = fs.existsSync,
): { file: string; args: string[] } {
  if (platform === "win32") {
    if (requestedShell === "wsl") return { file: "wsl.exe", args: [] };
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
  const usable = (file?: string): file is string =>
    !!file && (!path.isAbsolute(file) || exists(file));
  const file =
    [env.TERMIX_LOCAL_SHELL, env.SHELL, ...fallbacks].find(usable) ||
    fallbacks[0];
  return { file, args: ["-l"] };
}

/**
 * node-pty starts every shell through its spawn-helper binary, and a packaged
 * copy that lost its execute bit fails with "posix_spawnp failed". Returns how
 * many helpers were fixed.
 */
export function repairSpawnHelpers(ptyDir: string, fsImpl = fs): number {
  // A universal macOS build ships app-arm64.asar and app-x64.asar.
  const dir = ptyDir.replace(
    /\b(app(?:-[a-z0-9]+)?)\.asar(?!\.unpacked)/,
    "$1.asar.unpacked",
  );
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

interface NodePty {
  spawn: (
    file: string,
    args: string[],
    options: Record<string, unknown>,
  ) => {
    pid: number;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    onData: (cb: (data: string) => void) => { dispose: () => void };
    onExit: (cb: (e: { exitCode: number }) => void) => { dispose: () => void };
  };
}

const requireFromHere = createRequire(import.meta.url);

function loadNodePty(): NodePty {
  try {
    return requireFromHere("node-pty") as NodePty;
  } catch {
    throw new Error("The local terminal is not available in this build");
  }
}

export const MAX_PTY_COLS = 500;
export const MAX_PTY_ROWS = 300;

export function spawnLocalPty(options?: {
  cols?: number;
  rows?: number;
  shell?: string;
}): PluginLocalPty {
  const pty = loadNodePty();
  const cols = Math.min(MAX_PTY_COLS, Math.max(2, Number(options?.cols) || 80));
  const rows = Math.min(MAX_PTY_ROWS, Math.max(1, Number(options?.rows) || 24));
  const shellConfig = resolveLocalShell(process.platform, options?.shell);

  const start = () =>
    pty.spawn(shellConfig.file, shellConfig.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: os.homedir(),
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
    });

  let child: ReturnType<NodePty["spawn"]>;
  try {
    child = start();
  } catch (error) {
    const ptyDir = path.dirname(
      requireFromHere.resolve("node-pty/package.json"),
    );
    if (
      !String((error as Error)?.message).includes("posix_spawnp") ||
      repairSpawnHelpers(ptyDir) === 0
    ) {
      throw error;
    }
    child = start();
  }

  return {
    pid: child.pid,
    shell: shellConfig.file,
    write: (data) => {
      if (typeof data === "string" && data.length <= 64 * 1024) {
        child.write(data);
      }
    },
    resize: (c, r) => {
      if (
        Number.isInteger(c) &&
        Number.isInteger(r) &&
        c >= 2 &&
        c <= MAX_PTY_COLS &&
        r >= 1 &&
        r <= MAX_PTY_ROWS
      ) {
        child.resize(c, r);
      }
    },
    kill: () => child.kill(),
    onData: (handler) => {
      const sub = child.onData(handler);
      return () => sub.dispose();
    },
    onExit: (handler) => {
      const sub = child.onExit(({ exitCode }) => handler(exitCode));
      return () => sub.dispose();
    },
  };
}
