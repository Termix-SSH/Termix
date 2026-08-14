import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  hashSftpFile,
  verifySftpFileIntegrity,
} from "../../../hosts/file-manager/transfer-integrity.js";

type SFTPWrapper = import("ssh2").SFTPWrapper;

function fakeSftp(contents: Record<string, Buffer | Buffer[]>): SFTPWrapper {
  return {
    createReadStream: vi.fn((path: string) => {
      const value = contents[path];
      if (value === undefined) {
        return new Readable({
          read() {
            this.destroy(new Error(`Missing file: ${path}`));
          },
        });
      }
      return Readable.from(Array.isArray(value) ? value : [value]);
    }),
  } as unknown as SFTPWrapper;
}

describe("transfer integrity", () => {
  it("hashes all chunks in an SFTP file", async () => {
    const sftp = fakeSftp({
      "/file": [Buffer.from("hello "), Buffer.from("world")],
    });

    await expect(hashSftpFile(sftp, "/file")).resolves.toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("accepts matching source and destination files", async () => {
    const source = fakeSftp({ "/source": Buffer.from("same bytes") });
    const dest = fakeSftp({ "/dest": Buffer.from("same bytes") });

    await expect(
      verifySftpFileIntegrity(source, dest, "/source", "/dest"),
    ).resolves.toMatchObject({ algorithm: "sha256" });
  });

  it("rejects a corrupted destination", async () => {
    const source = fakeSftp({ "/source": Buffer.from("expected") });
    const dest = fakeSftp({ "/dest": Buffer.from("corrupted") });

    await expect(
      verifySftpFileIntegrity(source, dest, "/source", "/dest"),
    ).rejects.toThrow("SHA-256 verification failed for /source");
  });

  it("aborts hashing with the caller's cancellation error", async () => {
    const sftp = fakeSftp({ "/file": Buffer.from("data") });
    const cancelled = new Error("cancelled by test");

    await expect(
      hashSftpFile(
        sftp,
        "/file",
        () => true,
        () => cancelled,
      ),
    ).rejects.toBe(cancelled);
  });
});
