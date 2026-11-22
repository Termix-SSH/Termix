import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { sftpProxy } from "../../../../plugins/sandbox/child/sftp-proxy.js";

function endpoint(answer: (method: string, args: unknown[]) => unknown) {
  return {
    call: vi.fn(async (method: string, args: unknown[]) =>
      answer(method, args),
    ),
    notify: vi.fn(),
    openStream: vi.fn(),
  };
}

describe("sftpProxy", () => {
  it("is an EventEmitter a plugin can listen on, like ssh2's SFTPWrapper", () => {
    const sftp = sftpProxy(
      "s1",
      endpoint(() => null),
    );
    expect(sftp).toBeInstanceOf(EventEmitter);
    expect(() => sftp.on("error", () => {})).not.toThrow();
  });

  it("sends calls to core and hands back stats as ssh2 does", async () => {
    const core = endpoint(() => ({
      size: 3,
      $stats: { dir: false, file: true, link: false },
    }));
    const sftp = sftpProxy("s1", core);
    const stats = await new Promise<{ size: number; isFile: () => boolean }>(
      (resolve, reject) =>
        sftp.stat("/etc/hosts", (error: unknown, value: unknown) =>
          error ? reject(error) : resolve(value as never),
        ),
    );
    expect(core.call).toHaveBeenCalledWith("sftp.call", [
      "s1",
      "stat",
      ["/etc/hosts"],
    ]);
    expect(stats.size).toBe(3);
    expect(stats.isFile()).toBe(true);
  });

  it("closes once, when it ends or when its connection closes", () => {
    const connection = new EventEmitter();
    const core = endpoint(() => null);
    const sftp = sftpProxy("s1", core, connection);
    const closed = vi.fn();
    sftp.on("close", closed);

    connection.emit("close");
    sftp.end();
    expect(closed).toHaveBeenCalledOnce();
    expect(core.notify).toHaveBeenCalledWith("sftp.end", ["s1"]);
    expect(connection.listenerCount("close")).toBe(0);
  });
});
