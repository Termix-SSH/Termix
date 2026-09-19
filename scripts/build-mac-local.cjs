const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const { chmodSpawnHelpers } = require("./patch-node-pty.cjs");

/**
 * Локальная сборка Termix.app под macOS.
 *
 * Решает две проблемы окружения, которые ломают "npm run build:mac-dev":
 *
 * 1. SDK/тулчейн: `xcrun --show-sdk-path` может вернуть SDK из
 *    Command Line Tools (например macOS 27.0), тогда как clang берётся из
 *    Xcode (26.6). Новый SDK содержит .tbd с архитектурами, которые старый
 *    линкер не понимает ("unknown architecture arm64e.x1-macos"), поэтому
 *    SDKROOT принудительно указывает на SDK самого Xcode.
 * 2. cpu-features (необязательная зависимость ssh2) требует
 *    buildcheck.gypi, генерируемый её install-скриптом; если npm пропустил
 *    скрипт, electron-builder падал на этапе rebuild нативных модулей.
 *
 * После упаковки восстанавливаются права на spawn-helper (иначе локальный
 * терминал падает с "posix_spawnp failed.") и приложение подписывается
 * ad-hoc, чтобы macOS не убивала его после копирования.
 */

function resolveXcodeSdkRoot() {
  if (process.env.SDKROOT && fs.existsSync(process.env.SDKROOT)) {
    return process.env.SDKROOT;
  }

  try {
    const developerDir = execFileSync("xcode-select", ["-p"], {
      encoding: "utf8",
    }).trim();
    const candidate = path.join(
      developerDir,
      "Platforms",
      "MacOSX.platform",
      "Developer",
      "SDKs",
      "MacOSX.sdk",
    );
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // Игнорируем: сборка пойдёт с настройками по умолчанию.
  }

  return null;
}

function run(command, args, env) {
  console.log(`\n[build:mac-local] > ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd: rootDir, stdio: "inherit", env });
}

const sdkRoot = resolveXcodeSdkRoot();
const env = { ...process.env };
if (sdkRoot) {
  env.SDKROOT = sdkRoot;
  console.log(`[build:mac-local] SDKROOT=${sdkRoot}`);
} else {
  console.log("[build:mac-local] Xcode SDK не найден, SDKROOT по умолчанию");
}

const arch = process.arch === "x64" ? "x64" : "arm64";
const appPath = path.join(rootDir, "release", `mac-${arch}`, "Termix.app");

// Патчи node_modules: на свежем клоне postinstall может быть пропущен
// (например, из-за политики allowScripts в npm 12), поэтому применяем их явно
// до компиляции нативных модулей.
run("node", ["scripts/patch-better-sqlite3.cjs"], env);
run("node", ["scripts/patch-nan.cjs"], env);
run("node", ["scripts/patch-node-pty.cjs"], env);

run("npm", ["run", "build"], env);
run(
  "npx",
  [
    "electron-rebuild",
    "-f",
    "-o",
    "better-sqlite3,@serialport/bindings-cpp,node-pty",
  ],
  env,
);
run("npm", ["run", "electron:patch-builder"], env);
run(
  "npx",
  [
    "electron-builder",
    "--mac",
    "dir",
    `--${arch}`,
    "--publish=never",
  ],
  env,
);

// Страховка: права на spawn-helper внутри собранного приложения.
const unpackedNodePty = path.join(
  appPath,
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "node_modules",
  "node-pty",
);
const fixed = chmodSpawnHelpers(unpackedNodePty);
if (fixed > 0) {
  console.log(`[build:mac-local] Восстановлены права на ${fixed} spawn-helper`);
}

// Ad-hoc подпись: без неё приложение остаётся с чужой подписью Electron.
run(
  "codesign",
  [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    path.join(rootDir, "packaging", "build", "entitlements.mac.plist"),
    appPath,
  ],
  env,
);
run("codesign", ["--verify", "--deep", "--verbose=1", appPath], env);

console.log(`\n[build:mac-local] Готово: ${appPath}`);