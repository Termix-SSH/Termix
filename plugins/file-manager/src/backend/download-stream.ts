import { Readable } from "node:stream";
import type { SFTPWrapper } from "ssh2";
import {
  promisifySftpClose,
  promisifySftpOpen,
  SFTP_OPEN_READ,
} from "./sftp-promisify.js";

const CHUNK_SIZE = 32 * 1024;
const CONCURRENCY = 8;

/** Bounded read-ahead; batches retain file order even if replies arrive out of order. */
export function createDownloadStream(
  sftp: SFTPWrapper,
  path: string,
  size: number,
): Readable {
  const stream = Readable.from(readFile(), {
    objectMode: false,
    highWaterMark: CHUNK_SIZE,
  });
  return stream;

  async function readChunk(handle: Buffer, position: number, length: number) {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length && !stream.destroyed) {
      const bytesRead = await new Promise<number>((resolve, reject) => {
        sftp.read(
          handle,
          buffer,
          offset,
          length - offset,
          position + offset,
          (err, bytes) => (err ? reject(err) : resolve(bytes)),
        );
      });
      if (bytesRead === 0)
        throw new Error("File ended before the advertised size");
      offset += bytesRead;
    }
    return buffer;
  }

  async function* readFile() {
    if (stream.destroyed) return;
    const handle = await promisifySftpOpen(sftp, path, SFTP_OPEN_READ, 0o666);
    try {
      for (let position = 0; position < size && !stream.destroyed;) {
        const reads: Promise<Buffer>[] = [];
        for (let i = 0; i < CONCURRENCY && position < size; i++) {
          const length = Math.min(CHUNK_SIZE, size - position);
          reads.push(readChunk(handle, position, length));
          position += length;
        }
        // Settle all reads before closing the shared handle after an error.
        const results = await Promise.allSettled(reads);
        if (stream.destroyed) return;
        for (const result of results) {
          if (result.status === "rejected") throw result.reason;
          yield result.value;
        }
      }
    } finally {
      await promisifySftpClose(sftp, handle);
    }
  }
}
