import { promises as fs } from "fs";
import path from "path";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { systemLogger } from "./logger.js";

const OPKSSH_REPO = "openpubkey/opkssh";

function getBinaryDir(): string {
  const dataDir =
    process.env.DATA_DIR || path.join(process.cwd(), "db", "data");
  return path.join(dataDir, "opkssh");
}

function getVersionFile(): string {
  return path.join(getBinaryDir(), "version.txt");
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
      systemLogger.info("OPKSSH binary not found, downloading...", {
        operation: "opkssh_binary_download_start",
      });
      await this.downloadBinary();
      this.binaryPath = expectedPath;
      return expectedPath;
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

      const response = await fetch(asset.browser_download_url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const fileStream = createWriteStream(binaryPath);
      await pipeline(
        response.body as unknown as NodeJS.ReadableStream,
        fileStream,
      );

      await fs.chmod(binaryPath, 0o755);

      await fs.writeFile(getVersionFile(), release.tag_name, "utf8");

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

      const release = await this.getLatestRelease();
      const latestVersion = release.tag_name;

      if (localVersion !== latestVersion) {
        return true;
      }

      return false;
    } catch (error) {
      systemLogger.warn("Failed to check for OPKSSH updates", {
        operation: "opkssh_update_check_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  private static async getLatestRelease(): Promise<GitHubRelease> {
    const url = `https://api.github.com/repos/${OPKSSH_REPO}/releases/latest`;
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
      darwin: "darwin",
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
      darwin: "darwin",
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
