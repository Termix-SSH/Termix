import { getErrorMessage } from "./error-message.js";
import { createWriteStream, promises as fs } from "fs";
import crypto from "crypto";
import path from "path";
import { pipeline } from "stream/promises";
import { systemLogger } from "./logger.js";

const OPKSSH_REPO = "openpubkey/opkssh";
const DEFAULT_OPKSSH_VERSION = "v0.16.0";
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

function getBinaryDir(): string {
  const dataDir =
    process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
  return path.join(dataDir, "opkssh");
}

function getVersionFile(): string {
  return path.join(getBinaryDir(), "version.txt");
}

function getChecksumFile(): string {
  return path.join(getBinaryDir(), "checksum.txt");
}

function getTrustedRelease(binaryName: string): {
  version: string;
  checksum: string;
} {
  const version = process.env.OPKSSH_VERSION || DEFAULT_OPKSSH_VERSION;
  const configuredChecksum = process.env.OPKSSH_SHA256?.trim().toLowerCase();
  const checksum =
    version === DEFAULT_OPKSSH_VERSION
      ? DEFAULT_CHECKSUMS[binaryName]
      : configuredChecksum;
  if (!checksum || !/^[0-9a-f]{64}$/.test(checksum)) {
    throw new Error(
      `OPKSSH ${version} has no trusted SHA-256 checksum for ${binaryName}`,
    );
  }
  return { version, checksum };
}

async function sha256File(filePath: string): Promise<string> {
  const contents = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function verifyChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<void> {
  const actualChecksum = await sha256File(filePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`OPKSSH checksum mismatch for ${path.basename(filePath)}`);
  }
}

async function replaceBinary(
  temporaryPath: string,
  binaryPath: string,
): Promise<void> {
  const backupPath = `${binaryPath}.previous`;
  let backedUp = false;
  try {
    await fs.rename(binaryPath, backupPath);
    backedUp = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await fs.rename(temporaryPath, binaryPath);
    if (backedUp) await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (backedUp) await fs.rename(backupPath, binaryPath);
    throw error;
  }
}

function getBundledDir(): string {
  return (
    process.env.OPKSSH_BUNDLED_DIR || path.join(process.cwd(), "opkssh-bundled")
  );
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

export class OPKSSHBinaryManager {
  private static binaryPath: string | null = null;

  static async ensureBinary(): Promise<string> {
    if (this.binaryPath) {
      return this.binaryPath;
    }

    const binaryName = this.getBinaryName();
    const expectedPath = path.join(getBinaryDir(), binaryName);

    try {
      await fs.access(expectedPath);
      const storedChecksum = (await fs.readFile(getChecksumFile(), "utf8"))
        .trim()
        .toLowerCase();
      await verifyChecksum(expectedPath, storedChecksum);
      const needsUpdate = await this.checkForUpdate();
      if (needsUpdate) {
        systemLogger.info("Newer OPKSSH version available, updating...", {
          operation: "opkssh_binary_update_start",
        });
        await this.downloadBinary();
      }

      this.binaryPath = expectedPath;
      return expectedPath;
    } catch {
      const usedBundled = await this.useBundledBinary(expectedPath);
      if (usedBundled) {
        this.binaryPath = expectedPath;
        return expectedPath;
      }

      systemLogger.info("OPKSSH binary not found, downloading...", {
        operation: "opkssh_binary_download_start",
      });
      await this.downloadBinary();
      this.binaryPath = expectedPath;
      return expectedPath;
    }
  }

  private static async useBundledBinary(
    expectedPath: string,
  ): Promise<boolean> {
    const binaryName = this.getBinaryName();
    const bundledPath = path.join(getBundledDir(), binaryName);
    const { version, checksum } = getTrustedRelease(binaryName);

    try {
      await fs.access(bundledPath);
      await verifyChecksum(bundledPath, checksum);
      await fs.mkdir(getBinaryDir(), { recursive: true });
      await fs.copyFile(bundledPath, expectedPath);
      await fs.chmod(expectedPath, 0o755);
      await fs.writeFile(getChecksumFile(), checksum, "utf8");

      await fs.writeFile(getVersionFile(), version, "utf8");

      systemLogger.info("Using bundled OPKSSH binary", {
        operation: "opkssh_binary_bundled_used",
        path: expectedPath,
      });
      return true;
    } catch {
      return false;
    }
  }

  static async downloadBinary(): Promise<void> {
    try {
      await fs.mkdir(getBinaryDir(), { recursive: true });

      const release = await this.getLatestRelease();

      const asset = this.findMatchingAsset(release.assets);
      if (!asset) {
        throw new Error(
          `No matching OPKSSH binary found for platform ${process.platform} ${process.arch}`,
        );
      }

      const binaryName = this.getBinaryName();
      const binaryPath = path.join(getBinaryDir(), binaryName);
      const temporaryPath = `${binaryPath}.download-${crypto.randomUUID()}`;
      const { checksum } = getTrustedRelease(binaryName);

      const response = await fetch(asset.browser_download_url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      try {
        const fileStream = createWriteStream(temporaryPath, { mode: 0o600 });
        await pipeline(
          response.body as unknown as NodeJS.ReadableStream,
          fileStream,
        );
        await verifyChecksum(temporaryPath, checksum);
        await fs.chmod(temporaryPath, 0o755);
        await replaceBinary(temporaryPath, binaryPath);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true });
        throw error;
      }

      await fs.writeFile(getVersionFile(), release.tag_name, "utf8");
      await fs.writeFile(getChecksumFile(), checksum, "utf8");

      systemLogger.info(
        `OPKSSH binary downloaded successfully to ${binaryPath}`,
        {
          operation: "opkssh_binary_download_complete",
          path: binaryPath,
          version: release.tag_name,
        },
      );
    } catch (error) {
      systemLogger.error("Failed to download OPKSSH binary", error, {
        operation: "opkssh_binary_download_error",
      });
      throw error;
    }
  }

  static getBinaryPath(): string {
    if (!this.binaryPath) {
      throw new Error(
        "OPKSSH binary not initialized. Call ensureBinary() first.",
      );
    }
    return this.binaryPath;
  }

  private static async checkForUpdate(): Promise<boolean> {
    try {
      let localVersion: string | null = null;
      try {
        localVersion = await fs.readFile(getVersionFile(), "utf8");
        localVersion = localVersion.trim();
      } catch {
        return true;
      }

      const latestVersion = getTrustedRelease(this.getBinaryName()).version;

      if (localVersion !== latestVersion) {
        return true;
      }

      return false;
    } catch (error) {
      systemLogger.warn("Failed to check for OPKSSH updates", {
        operation: "opkssh_update_check_failed",
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  private static async getLatestRelease(): Promise<GitHubRelease> {
    const { version } = getTrustedRelease(this.getBinaryName());
    const url = `https://api.github.com/repos/${OPKSSH_REPO}/releases/tags/${encodeURIComponent(version)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Termix",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch release info: ${response.statusText}`);
    }

    return (await response.json()) as GitHubRelease;
  }

  private static findMatchingAsset(assets: GitHubAsset[]): GitHubAsset | null {
    const platform = process.platform;
    const arch = process.arch;

    const osMap: Record<string, string> = {
      win32: "windows",
      linux: "linux",
      darwin: "osx",
    };

    const archMap: Record<string, string> = {
      x64: "amd64",
      arm64: "arm64",
    };

    const mappedOs = osMap[platform];
    const mappedArch = archMap[arch];

    if (!mappedOs || !mappedArch) {
      return null;
    }

    const patterns = [
      `opkssh-${mappedOs}-${mappedArch}.exe`,
      `opkssh-${mappedOs}-${mappedArch}`,
      `opkssh_${mappedOs}_${mappedArch}.exe`,
      `opkssh_${mappedOs}_${mappedArch}`,
    ];

    for (const pattern of patterns) {
      const asset = assets.find(
        (a) => a.name.toLowerCase() === pattern.toLowerCase(),
      );
      if (asset) {
        return asset;
      }
    }

    return null;
  }

  private static getBinaryName(): string {
    const platform = process.platform;
    const arch = process.arch;

    const osMap: Record<string, string> = {
      win32: "windows",
      linux: "linux",
      darwin: "osx",
    };

    const archMap: Record<string, string> = {
      x64: "amd64",
      arm64: "arm64",
    };

    const mappedOs = osMap[platform] || platform;
    const mappedArch = archMap[arch] || arch;

    const extension = platform === "win32" ? ".exe" : "";
    return `opkssh-${mappedOs}-${mappedArch}${extension}`;
  }
}
