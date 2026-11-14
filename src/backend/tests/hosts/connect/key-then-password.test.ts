import { afterEach, describe, expect, it } from "vitest";
import { generateSshKeyPair } from "../../../../../packages/plugin-sdk/src/ssh-keys.js";
import ssh2 from "ssh2";

const { Client, Server } = ssh2;

// The order prepareKey sets when a host has both a key and a password.
const AUTH_ORDER = ["publickey", "password", "keyboard-interactive"];
// ssh2's own generator makes about 1 in 256 ed25519 keys nothing can read.
const pair = generateSshKeyPair("ssh-ed25519");
const keys = { private: pair.privateKey };

let server: InstanceType<typeof Server> | null = null;
afterEach(() => server?.close());

/** A server with AuthenticationMethods publickey,password. */
function start(): Promise<number> {
  server = new Server({ hostKeys: [keys.private] }, (client) => {
    let keyDone = false;
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey") {
        if (ctx.signature) {
          keyDone = true;
          ctx.reject(["password"], true);
        } else {
          ctx.accept();
        }
      } else if (ctx.method === "password" && keyDone) {
        ctx.accept();
      } else {
        ctx.reject(keyDone ? ["password"] : ["publickey"]);
      }
    });
    client.on("ready", () => client.end());
    client.on("error", () => {});
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () =>
      resolve((server!.address() as { port: number }).port),
    );
  });
}

function connect(port: number, authHandler?: string[]) {
  return new Promise<string>((resolve) => {
    const client = new Client();
    client.on("ready", () => {
      client.end();
      resolve("ready");
    });
    client.on("error", (error) => resolve(error.message));
    client.connect({
      host: "127.0.0.1",
      port,
      username: "u",
      privateKey: keys.private,
      password: "pw",
      ...(authHandler ? { authHandler } : {}),
    } as never);
  });
}

describe("a server that wants a key, then a password", () => {
  it("logs in with the key first order", async () => {
    expect(await connect(await start(), AUTH_ORDER)).toBe("ready");
  });

  it("fails with ssh2's default order, which tries the password first", async () => {
    expect(await connect(await start())).toMatch(/authentication/i);
  });
});
