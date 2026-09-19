// New file for the local macOS build of this fork — see README_LOCAL.md.
// Upstream: https://github.com/Termix-SSH/Termix (Apache License 2.0).
// Часть правок повторяет upstream PR #1417 (восстановление exec-бита), часть
// специфична для этой сборки: generic .asar → .asar.unpacked, NULL-guard в
// spawn-helper.cc, честный errno в pty.cc.
const fs = require("node:fs");
const path = require("node:path");

const nodePtyDir = path.join(__dirname, "..", "node_modules", "node-pty");
const MARKER = "termix-patch";

function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return false;

  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const { original, patched } of replacements) {
    if (source.includes(patched)) continue;
    if (!source.includes(original)) continue;
    source = source.replace(original, patched);
    changed = true;
  }

  if (changed) fs.writeFileSync(filePath, source);
  return changed;
}

/**
 * Restore the execute bit on every spawn-helper copy.
 *
 * npm (and the Homebrew cask) extract non-bin files with mode 0644, so
 * posix_spawn() returns EACCES and node-pty surfaces the misleading
 * "posix_spawnp failed." error, which breaks the local terminal.
 */
function chmodSpawnHelpers(rootDir) {
  const stack = [rootDir];
  let fixed = 0;

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.name !== "spawn-helper") continue;

      try {
        const mode = fs.statSync(fullPath).mode & 0o777;
        if ((mode & 0o100) === 0) {
          fs.chmodSync(fullPath, 0o755);
          fixed++;
        }
      } catch {
        // Ignore: a locked down path is reported by the spawn error itself.
      }
    }
  }

  return fixed;
}

/**
 * JS side: fix helperPath resolution and self-heal the execute bit.
 *
 * Two packaging bugs are fixed here:
 * 1. `replace('app.asar', 'app.asar.unpacked')` never matches a renamed
 *    archive such as app-arm64.asar, so packaged builds passed a path INSIDE
 *    the asar archive to posix_spawn() (ENOENT).
 * 2. The helper ships without the execute bit, so posix_spawn() failed with
 *    EACCES even when the path was correct.
 */
const helperResolutionOriginalJs = [
  "var helperPath = native.dir + '/spawn-helper';",
  "helperPath = path.resolve(__dirname, helperPath);",
  "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
].join("\n");

const helperResolutionPatchedJs = [
  "var helperPath = native.dir + '/spawn-helper';",
  "helperPath = path.resolve(__dirname, helperPath);",
  `// ${MARKER}: rewrite the asar segment generically (app.asar, app-arm64.asar,`,
  "// node_modules.asar) and prefer the unpacked file - posix_spawn() cannot",
  "// open a path that lives inside an asar archive.",
  "if (helperPath.indexOf('.asar') !== -1) {",
  "    var unpackedHelperPath = helperPath.replace(/\\.asar(?=[\\\\/]|$)/, '.asar.unpacked');",
  "    if (unpackedHelperPath !== helperPath && fs.existsSync(unpackedHelperPath)) {",
  "        helperPath = unpackedHelperPath;",
  "    }",
  "}",
  `// ${MARKER}: the helper is extracted without the execute bit (0644), so`,
  "// posix_spawn() fails with EACCES. Restore it before the first fork.",
  "try {",
  "    fs.chmodSync(helperPath, 0o755);",
  "} catch (e) {",
  "    // Not fatal: the spawn error below reports the real problem.",
  "}",
].join("\n");

const helperResolutionOriginalTs = [
  "let helperPath = native.dir + '/spawn-helper';",
  "helperPath = path.resolve(__dirname, helperPath);",
  "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
  "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
].join("\n");

const helperResolutionPatchedTs = [
  "let helperPath = native.dir + '/spawn-helper';",
  "helperPath = path.resolve(__dirname, helperPath);",
  `// ${MARKER}: same asar/execute-bit fix as lib/unixTerminal.js.`,
  "if (helperPath.indexOf('.asar') !== -1) {",
  "  const unpackedHelperPath = helperPath.replace(/\\.asar(?=[\\\\/]|$)/, '.asar.unpacked');",
  "  if (unpackedHelperPath !== helperPath && fs.existsSync(unpackedHelperPath)) {",
  "    helperPath = unpackedHelperPath;",
  "  }",
  "}",
  "try {",
  "  fs.chmodSync(helperPath, 0o755);",
  "} catch {",
  "  // Not fatal: spawning reports the real problem.",
  "}",
].join("\n");

module.exports = { chmodSpawnHelpers };

if (require.main !== module) {
  return;
}

if (!fs.existsSync(nodePtyDir)) {
  console.log("[patch-node-pty] node-pty not found, skipping");
  process.exit(0);
}
/**
 * Native side: make spawn-helper crash-proof and report real errors.
 */
const spawnHelperPath = path.join(nodePtyDir, "src", "unix", "spawn-helper.cc");

const spawnHelperPatched = `#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main (int argc, char** argv) {
  // ${MARKER}: the original code called ttyname() without a NULL check and
  // then open()ed the result, which segfaults (SIGSEGV at 0x0) whenever stdin
  // is not a pty. That crash was reported by the caller as "posix_spawnp
  // failed." and made the local terminal unusable.
  if (argc < 3) {
    fprintf(stderr, "spawn-helper: usage: spawn-helper <cwd> <file> [args...]\\n");
    _exit(2);
  }

  // open() implicitly attaches the process to a terminal device when the
  // process has no controlling terminal yet and O_NOCTTY is not set.
  char *slave_path = ttyname(STDIN_FILENO);
  if (slave_path != NULL) {
    int slave_fd = open(slave_path, O_RDWR);
    if (slave_fd >= 0) {
      close(slave_fd);
    }
  }

  const char *cwd = argv[1];
  char *file = argv[2];
  argv = &argv[2];

  if (cwd != NULL && strlen(cwd) != 0 && chdir(cwd) == -1) {
    fprintf(stderr, "spawn-helper: chdir(%s) failed: %s\\n", cwd, strerror(errno));
    _exit(1);
  }

  execvp(file, argv);
  fprintf(stderr, "spawn-helper: execvp(%s) failed: %s\\n", file, strerror(errno));
  return 127;
}
`;

let spawnHelperRewritten = false;
if (fs.existsSync(spawnHelperPath)) {
  const current = fs.readFileSync(spawnHelperPath, "utf8");
  if (!current.includes(MARKER)) {
    fs.writeFileSync(spawnHelperPath, spawnHelperPatched);
    spawnHelperRewritten = true;
  }
}

const ptyCcPath = path.join(nodePtyDir, "src", "unix", "pty.cc");

const ptyCcPatched = patchFile(ptyCcPath, [
  {
    original: `  *master = posix_openpt(O_RDWR);
  if (*master == -1) {
    return;
  }`,
    patched: `  *master = posix_openpt(O_RDWR);
  if (*master == -1) {
    *err = errno != 0 ? errno : EIO; // ${MARKER}
    return;
  }`,
  },
  {
    original: `  int res = grantpt(*master) || unlockpt(*master);
  if (res == -1) {
    return;
  }`,
    patched: `  int res = grantpt(*master) || unlockpt(*master);
  if (res == -1) {
    *err = errno != 0 ? errno : EIO; // ${MARKER}
    return;
  }`,
  },
  {
    original: `  res = ioctl(*master, TIOCPTYGNAME, slave_pty_name);
  if (res == -1) {
    return;
  }`,
    patched: `  res = ioctl(*master, TIOCPTYGNAME, slave_pty_name);
  if (res == -1) {
    *err = errno != 0 ? errno : EIO; // ${MARKER}
    return;
  }`,
  },
  {
    original: `  slave = open(slave_pty_name, O_RDWR | O_NOCTTY);
  if (slave == -1) {
    return;
  }`,
    patched: `  slave = open(slave_pty_name, O_RDWR | O_NOCTTY);
  if (slave == -1) {
    *err = errno != 0 ? errno : EIO; // ${MARKER}
    return;
  }`,
  },
  {
    original: `  if (termp) {
    res = tcsetattr(slave, TCSANOW, termp);
    if (res == -1) {
      return;
    };`,
    patched: `  if (termp) {
    res = tcsetattr(slave, TCSANOW, termp);
    if (res == -1) {
      *err = errno != 0 ? errno : EIO; // ${MARKER}
      return;
    };`,
  },
  {
    original: `  throw Napi::Error::New(napiEnv, "posix_spawnp failed.");`,
    patched: `  // ${MARKER}: report the real failure reason instead of a generic message.
  throw Napi::Error::New(
      napiEnv,
      "posix_spawnp failed: " + std::string(strerror(err)) + " (errno " +
          std::to_string(err) + ", helper: " + helper_path + ")");`,
  },
]);

const jsPatched = patchFile(
  path.join(nodePtyDir, "lib", "unixTerminal.js"),
  [{ original: helperResolutionOriginalJs, patched: helperResolutionPatchedJs }],
);

const tsPatched = patchFile(
  path.join(nodePtyDir, "src", "unixTerminal.ts"),
  [{ original: helperResolutionOriginalTs, patched: helperResolutionPatchedTs }],
);

const helpersFixed = chmodSpawnHelpers(nodePtyDir);

const changes = [
  spawnHelperRewritten ? "src/unix/spawn-helper.cc (NULL-guard)" : null,
  ptyCcPatched ? "src/unix/pty.cc (errno reporting)" : null,
  jsPatched ? "lib/unixTerminal.js (helper path + exec bit)" : null,
  tsPatched ? "src/unixTerminal.ts (helper path + exec bit)" : null,
  helpersFixed > 0 ? `${helpersFixed} spawn-helper execute bit(s)` : null,
].filter(Boolean);

if (changes.length > 0) {
  console.log(`[patch-node-pty] Applied: ${changes.join(", ")}`);
} else {
  console.log("[patch-node-pty] Already patched or target code not found");
}