const fs = require("fs");
const path = require("path");
const { changelogSection } = require("./lib/changelog-section.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function fail(message) {
  console.error(`generate-release-body: ${message}`);
  process.exit(1);
}

function buildTable(version, mobileVersion, mobileTag) {
  const tag = `v${version}`;
  const base = `https://github.com/Termix-SSH/Termix/releases/download/${tag}`;
  const mobileBase = `https://github.com/Termix-SSH/Mobile/releases/download/${mobileTag || `release-${mobileVersion}-tag`}`;

  const win = (file) => `${base}/${file}`;
  const linux = (file) => `${base}/${file}`;
  const mac = (file) => `${base}/${file}`;

  return [
    `| Architecture      | Windows                                                                                  | Linux                                                                                     | Mac                                                                                       | Android                                      | iOS                                |`,
    `|------------------|------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------|---------------------------------------------|-----------------------------------|`,
    `| **x86-64 (64-bit)** | [EXE](${win("termix_windows_x64_nsis.exe")}) · [MSI](${win("termix_windows_x64_msi.msi")}) · [Portable](${win("termix_windows_x64_portable.zip")}) | [AppImage](${linux("termix_linux_x64_appimage.AppImage")}) · [DEB](${linux("termix_linux_x64_deb.deb")}) · [Portable](${linux("termix_linux_x64_portable.tar.gz")}) | [DMG](${mac("termix_macos_x64_dmg.dmg")}) | - | - |`,
    `| **AArch64 (ARM64)** | - | [AppImage](${linux("termix_linux_arm64_appimage.AppImage")}) · [DEB](${linux("termix_linux_arm64_deb.deb")}) · [Portable](${linux("termix_linux_arm64_portable.tar.gz")}) | [DMG](${mac("termix_macos_arm64_dmg.dmg")}) | [APK (${mobileVersion})](${mobileBase}/termix_android.apk) | [IPA (${mobileVersion})](${mobileBase}/termix_ios.ipa) |`,
    `| **ARMv7 (32-bit)**  | - | [AppImage](${linux("termix_linux_armv7l_appimage.AppImage")}) · [DEB](${linux("termix_linux_armv7l_deb.deb")}) · [Portable](${linux("termix_linux_armv7l_portable.tar.gz")}) | - | - | - |`,
    `| **x86-32 (32-bit)** | [EXE](${win("termix_windows_ia32_nsis.exe")}) · [MSI](${win("termix_windows_ia32_msi.msi")}) · [Portable](${win("termix_windows_ia32_portable.zip")}) | - | - | - | - |`,
    `| **Universal**      | [Chocolatey](https://docs.termix.site/install/apps/windows) | [Flatpak](https://docs.termix.site/install/apps/linux) | [DMG](${mac("termix_macos_universal_dmg.dmg")}) · [App Store](https://apps.apple.com/us/app/termix-ssh-companion/id6752672071) · [Homebrew](https://docs.termix.site/install/apps/macos) | - | - |`,
  ].join("\n");
}

function buildBody({ version, mobileVersion, mobileTag, changelog }) {
  const notes = changelogSection(changelog, version);
  if (!notes) fail(`CHANGELOG.md has no notes for ${version}`);

  const donateAlert = [
    "> [!TIP]",
    "> Termix is free and always will be. If it's useful to you, consider [donating](https://donate.termix.site/donate/) to support development.",
  ].join("\n");

  return [
    donateAlert,
    "",
    notes,
    "",
    "### Downloads",
    "",
    buildTable(version, mobileVersion, mobileTag),
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const mobileVersion = args["mobile-version"];
  const mobileTag =
    typeof args["mobile-tag"] === "string" ? args["mobile-tag"] : undefined;
  const changelogPath = path.resolve(args.changelog || "CHANGELOG.md");

  if (!version || version === true) fail("--version is required");
  if (!mobileVersion || mobileVersion === true)
    fail("--mobile-version is required");
  if (!fs.existsSync(changelogPath)) {
    fail(`changelog not found: ${changelogPath}`);
  }

  const changelog = fs.readFileSync(changelogPath, "utf8");
  process.stdout.write(
    buildBody({ version, mobileVersion, mobileTag, changelog }) + "\n",
  );
}

if (require.main === module) {
  main();
}

module.exports = { buildBody };
