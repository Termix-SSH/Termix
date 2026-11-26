/**
 * An SFTP session core holds, as a plugin process sees it: the ssh2 SFTP
 * calls a plugin makes, sent to core. Like ssh2's own SFTPWrapper it is an
 * EventEmitter, since plugins listen for "error" and "close" on it, and it
 * closes when it ends or its connection does.
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { StreamPort } from "../rpc.js";

type AnyFn = (...args: unknown[]) => unknown;

/** What the proxy needs of the RPC endpoint. */
export interface SftpEndpoint {
  call: (method: string, args: unknown[]) => Promise<unknown>;
  notify: (method: string, args: unknown[]) => void;
  openStream: () => StreamPort;
}

const SFTP_METHODS = [
  "stat",
  "lstat",
  "readFile",
  "writeFile",
  "rename",
  "mkdir",
  "unlink",
  "readdir",
  "rmdir",
  "realpath",
  "chmod",
  "chown",
  "utimes",
  "symlink",
  "readlink",
  "exists",
];

export function sftpProxy(
  id: string,
  endpoint: SftpEndpoint,
  connection?: EventEmitter,
): EventEmitter & Record<string, AnyFn> {
  const proxy = new EventEmitter() as EventEmitter & Record<string, AnyFn>;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    connection?.off("close", close);
    proxy.emit("close");
  };
  connection?.once("close", close);
  for (const method of SFTP_METHODS) {
    proxy[method] = (...args: unknown[]) => {
      const cb = (
        typeof args[args.length - 1] === "function" ? args.pop() : () => {}
      ) as AnyFn;
      endpoint
        .call("sftp.call", [id, method, args])
        .then((value) =>
          method === "exists" ? cb(value) : cb(undefined, withStats(value)),
        )
        .catch((error) => cb(error));
    };
  }
  proxy.createReadStream = (path: unknown) => {
    const out = new PassThrough();
    endpoint
      .call("sftp.read", [id, String(path)])
      .then((value) => {
        const port = value as StreamPort;
        port.pipe(out);
        port.on("error", (error) => out.destroy(error));
      })
      .catch((error) => out.destroy(error));
    return out;
  };
  proxy.createWriteStream = (path: unknown) => {
    const port = endpoint.openStream();
    const done = endpoint.call("sftp.write", [id, String(path), port]);
    done.then(
      () => port.emit("finish-remote"),
      (error) => port.destroy(error),
    );
    return port;
  };
  proxy.end = () => {
    endpoint.notify("sftp.end", [id]);
    close();
  };
  return proxy;
}

function withStats(value: unknown): unknown {
  if (!value || typeof value !== "object" || Buffer.isBuffer(value))
    return value;
  if (Array.isArray(value)) return value.map(withStats);
  const record = value as Record<string, unknown> & {
    $stats?: { dir: boolean; file: boolean; link: boolean };
  };
  if (record.$stats) {
    const { $stats: flags, ...rest } = record;
    return {
      ...rest,
      isDirectory: () => flags.dir,
      isFile: () => flags.file,
      isSymbolicLink: () => flags.link,
    };
  }
  if (record.attrs) return { ...record, attrs: withStats(record.attrs) };
  return value;
}
