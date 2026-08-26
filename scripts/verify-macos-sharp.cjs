const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const architectures = {
  x64: ["x64"],
  arm64: ["arm64"],
  universal: ["x64", "arm64"],
};

function expectedArchitecture(artifact) {
  const name = path.basename(artifact);
  if (name.includes("_x64_")) return "x64";
  if (name.includes("_arm64_")) return "arm64";
  if (name.includes("_universal_")) return "universal";
  throw new Error(`Cannot determine architecture from artifact name: ${name}`);
}

function findApp(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) return candidate;
      if (entry.isDirectory()) pending.push(candidate);
    }
  }
  throw new Error(`No .app bundle found below ${root}`);
}

function containsFile(root, suffix) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      if (entry.isFile() && entry.name.endsWith(suffix)) return true;
    }
  }
  return false;
}

function verifyApp(app, architecture, runtimeCheck) {
  const modules = path.join(
    app,
    "Contents/Resources/app.asar.unpacked/node_modules",
  );

  for (const arch of architectures[architecture]) {
    for (const [packageName, nativeSuffix] of [
      [`sharp-darwin-${arch}`, ".node"],
      [`sharp-libvips-darwin-${arch}`, ".dylib"],
    ]) {
      const packagePath = path.join(modules, "@img", packageName);
      if (
        !fs.existsSync(packagePath) ||
        !containsFile(packagePath, nativeSuffix)
      ) {
        throw new Error(
          `${path.basename(app)} is missing the native binary from @img/${packageName}`,
        );
      }
    }
  }

  if (!runtimeCheck) return;

  const executable = path.join(app, "Contents/MacOS/Termix");
  const sharpPath = path.join(modules, "sharp");
  const smoke = [
    "const sharp = require(process.argv[1]);",
    "sharp({create:{width:1,height:1,channels:4,background:'#000'}})",
    ".png().toBuffer().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });",
  ].join("");

  for (const arch of architectures[architecture]) {
    const result = spawnSync(
      "arch",
      [
        arch === "x64" ? "-x86_64" : "-arm64",
        executable,
        "-e",
        smoke,
        sharpPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `${path.basename(app)} failed the ${arch} sharp runtime smoke test:\n${result.stderr || result.stdout}`,
      );
    }
  }
}

function verifyArtifact(artifact) {
  const architecture = expectedArchitecture(artifact);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "termix-sharp-"));
  let mountedAt;

  try {
    if (artifact.endsWith(".dmg")) {
      mountedAt = path.join(temporaryRoot, "mounted");
      fs.mkdirSync(mountedAt);
      execFileSync("hdiutil", [
        "attach",
        artifact,
        "-readonly",
        "-nobrowse",
        "-mountpoint",
        mountedAt,
      ]);
      verifyApp(findApp(mountedAt), architecture, true);
    } else if (artifact.endsWith(".pkg")) {
      const expanded = path.join(temporaryRoot, "expanded");
      execFileSync("pkgutil", ["--expand-full", artifact, expanded]);
      verifyApp(findApp(expanded), architecture, false);
    } else {
      throw new Error(`Unsupported macOS artifact: ${artifact}`);
    }
    console.log(`Verified macOS sharp packaging: ${path.basename(artifact)}`);
  } finally {
    if (mountedAt) {
      spawnSync("hdiutil", ["detach", mountedAt], { stdio: "ignore" });
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = { expectedArchitecture, verifyApp };

if (require.main === module) {
  if (process.platform !== "darwin") {
    throw new Error("macOS sharp artifact verification must run on macOS");
  }
  if (process.argv.length < 3) {
    throw new Error(
      "Usage: node scripts/verify-macos-sharp.cjs <artifact> [...]",
    );
  }

  for (const artifact of process.argv.slice(2))
    verifyArtifact(path.resolve(artifact));
}
