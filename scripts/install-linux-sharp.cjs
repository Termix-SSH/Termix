const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function findPackage(start) {
  let directory = path.dirname(start);
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest));
    directory = path.dirname(directory);
  }
  throw new Error("Could not locate the installed sharp package manifest");
}

// The build runs on x64 but ships arm64 and armv7l too, so npm ci alone
// only installs the x64 binaries.
function linuxSharpPackages(sharpPackage) {
  return ["x64", "arm64", "arm"].flatMap((arch) =>
    [`@img/sharp-linux-${arch}`, `@img/sharp-libvips-linux-${arch}`].map(
      (name) => {
        const version = sharpPackage.optionalDependencies?.[name];
        if (!version) {
          throw new Error(`sharp does not declare ${name} as a dependency`);
        }
        return `${name}@${version}`;
      },
    ),
  );
}

module.exports = { linuxSharpPackages };

if (require.main === module) {
  const sharpPackage = findPackage(require.resolve("sharp"));
  execFileSync(
    "npm",
    [
      "install",
      "--force",
      "--no-save",
      "--ignore-scripts",
      ...linuxSharpPackages(sharpPackage),
    ],
    { stdio: "inherit" },
  );
}
