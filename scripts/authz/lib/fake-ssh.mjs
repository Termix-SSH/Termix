// A small SSH server on loopback so hosts, terminals and share links are real.
// It accepts one password login and echoes a prompt; it records what each
// shell received so a read-only guest can be shown to type nothing.
import crypto from "node:crypto";
import ssh2 from "ssh2";

const { Server } = ssh2;

export async function startFakeSsh({ username, password }) {
  const { private: privateKey } = ssh2.utils.generateKeyPairSync("ed25519");
  const received = [];
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client.on("authentication", (ctx) => {
      const ok =
        ctx.method === "password" &&
        ctx.username === username &&
        ctx.password === password;
      if (ok) ctx.accept();
      else ctx.reject(["password"]);
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (accept) => accept?.());
        session.on("window-change", (accept) => accept?.());
        session.on("env", (accept) => accept?.());
        session.on("shell", (accept) => {
          const stream = accept();
          stream.write("authz$ ");
          stream.on("data", (data) => {
            received.push(data.toString());
            stream.write(data);
          });
        });
        session.on("exec", (accept, _reject, info) => {
          const stream = accept();
          received.push(`exec:${info.command}`);
          stream.exit(0);
          stream.end();
        });
        session.on("subsystem", (_accept, reject) => reject?.());
      });
    });
    client.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    received,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** RFC 6238 code for a base32 secret. */
export function totpCode(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = crypto
    .createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}
