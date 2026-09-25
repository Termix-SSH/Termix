import path from "node:path";
import type { PluginBinarySpec } from "@termix/plugin-sdk/backend";

export const DEFAULT_VERSION = "v0.16.0";

const DEFAULT_CHECKSUMS: Record<string, string> = {
  "opkssh-linux-amd64":
    "c018c3e7baf98612b923e742dd87be38650bf61e3b755fb2bc90de177568b1bf",
  "opkssh-linux-arm64":
    "9dd10c2b6ce99cde18e52c054877ca014134b291fd82afe71741c68db4f83d44",
  "opkssh-osx-amd64":
    "e1ccddb4a73c7dd24e0677e9c933462b954dde9a151fcd96c8ee7ba83bc3f146",
  "opkssh-osx-arm64":
    "be279812cc4d44a28f8cb6eef4b13515fae16b6d00ae61e21630e0c061b02cbd",
  "opkssh-windows-amd64.exe":
    "db8991ceaac7ac224b704510ca6fba2114998291d4283de4bc2d3b8efa66ad07",
  "opkssh-windows-arm64.exe":
    "c35352dc2d12ef3775b280aa85dc1e97ff90cd8ad4beb62c3e2357fdf80ba5af",
};

const OS_NAMES: Record<string, string> = {
  linux: "linux",
  darwin: "osx",
  win32: "windows",
};

const ARCH_NAMES: Record<string, string> = {
  x64: "amd64",
  arm64: "arm64",
};

/** The release asset name for this server, e.g. "opkssh-linux-amd64". */
export function binaryName(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const os = OS_NAMES[platform] ?? platform;
  const cpu = ARCH_NAMES[arch] ?? arch;
  return `opkssh-${os}-${cpu}${platform === "win32" ? ".exe" : ""}`;
}

/**
 * What ctx.process.ensureBinary needs for OPKSSH.
 *
 * The pinned version is trusted by its built-in checksums. OPKSSH_VERSION
 * picks another release, and then OPKSSH_SHA256 (or OPKSSH_SHA256_AMD64 /
 * OPKSSH_SHA256_ARM64, which the Docker image passes on) gives its checksum.
 *
 * The Docker image bakes the binary into /app/opkssh-bundled (the
 * opkssh-downloader stage), which is checked first so an offline install
 * never downloads. OPKSSH_BUNDLED_DIR points somewhere else.
 */
export function binarySpec(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
  arch: string = process.arch,
  cwd: string = process.cwd(),
): PluginBinarySpec {
  const name = binaryName(platform, arch);
  const version = env.OPKSSH_VERSION || DEFAULT_VERSION;
  const sha256 =
    version === DEFAULT_VERSION
      ? DEFAULT_CHECKSUMS[name]
      : (
          env.OPKSSH_SHA256 ||
          env[`OPKSSH_SHA256_${arch === "arm64" ? "ARM64" : "AMD64"}`]
        )
          ?.trim()
          .toLowerCase();
  if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `OPKSSH ${version} has no trusted SHA-256 checksum for ${name}`,
    );
  }
  const bundledDir = env.OPKSSH_BUNDLED_DIR || path.join(cwd, "opkssh-bundled");
  return {
    name,
    version,
    sha256,
    url: `https://github.com/openpubkey/opkssh/releases/download/${version}/${name}`,
    prebuilt: [path.join(bundledDir, name)],
  };
}
