import dgram from "dgram";
import net from "net";
import ssh2Pkg, {
  type IdentityCallback,
  type ParsedKey,
  type SignCallback,
  type SigningRequestOptions,
} from "ssh2";

const { BaseAgent } = ssh2Pkg;

export class MemoryAgent extends BaseAgent {
  private key: ParsedKey;

  constructor(key: ParsedKey) {
    super();
    this.key = key;
  }

  getIdentities(cb: IdentityCallback<ParsedKey>): void {
    cb(null, [this.key]);
  }

  sign(
    _pubKey: ParsedKey | Buffer | string,
    data: Buffer,
    optionsOrCb: SigningRequestOptions | SignCallback,
    cb?: SignCallback,
  ): void {
    const callback = typeof optionsOrCb === "function" ? optionsOrCb : cb!;
    const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
    try {
      const algo =
        options.hash === "sha256"
          ? "rsa-sha2-256"
          : options.hash === "sha512"
            ? "rsa-sha2-512"
            : undefined;
      const signature = this.key.sign(data, algo);
      callback(null, signature);
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export async function performPortKnocking(
  host: string,
  sequence: Array<{ port: number; protocol?: string; delay?: number }>,
): Promise<void> {
  for (const knock of sequence) {
    const protocol = knock.protocol || "tcp";
    const delay = knock.delay ?? 100;

    await new Promise<void>((resolve) => {
      if (protocol === "udp") {
        const client = dgram.createSocket("udp4");
        client.send(Buffer.alloc(0), knock.port, host, () => {
          client.close();
          resolve();
        });
      } else {
        const socket = new net.Socket();
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", () => {
          socket.destroy();
          resolve();
        });
        socket.connect(knock.port, host);
      }
    });

    if (delay > 0) {
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
}
