const fs = require("fs");
const path = require("path");

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJsonWithTrailingNewline(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return { data: JSON.parse(raw), hadTrailingNewline: raw.endsWith("\n") };
}

function writeJson(filePath, data, hadTrailingNewline) {
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(
    filePath,
    hadTrailingNewline ? serialized + "\n" : serialized,
  );
}

function syncVersion(version, options = {}) {
  if (!SEMVER.test(version || "")) {
    throw new Error(`invalid version "${version}" (expected X.Y.Z)`);
  }

  const root = options.root || path.join(__dirname, "..");
  const pkgPath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");

  const changed = [];

  const pkg = readJsonWithTrailingNewline(pkgPath);
  if (pkg.data.version !== version) {
    pkg.data.version = version;
    writeJson(pkgPath, pkg.data, pkg.hadTrailingNewline);
    changed.push("package.json");
  }

  if (fs.existsSync(lockPath)) {
    const lock = readJsonWithTrailingNewline(lockPath);
    let lockChanged = false;

    if (lock.data.version !== version) {
      lock.data.version = version;
      lockChanged = true;
    }
    if (lock.data.packages && lock.data.packages[""]) {
      if (lock.data.packages[""].version !== version) {
        lock.data.packages[""].version = version;
        lockChanged = true;
      }
    }

    if (lockChanged) {
      writeJson(lockPath, lock.data, lock.hadTrailingNewline);
      changed.push("package-lock.json");
    }
  }

  return changed;
}

module.exports = { syncVersion };

if (require.main === module) {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--version");
  const version = idx !== -1 ? args[idx + 1] : undefined;

  try {
    const changed = syncVersion(version);
    if (changed.length === 0) {
      console.log(`sync-version: already at ${version}, no change`);
    } else {
      console.log(`sync-version: set ${version} in ${changed.join(", ")}`);
    }
  } catch (err) {
    console.error(`sync-version: ${err.message}`);
    process.exit(1);
  }
}
