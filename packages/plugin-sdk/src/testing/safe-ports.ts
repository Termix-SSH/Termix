/**
 * Keeps a test server's random port off the fetch spec's blocked list.
 *
 * Tests start servers on port 0 and call them with fetch, which refuses
 * ports like 6000 or 6667 with "bad port". Linux never hands those out as
 * ephemeral ports, but Windows can (its dynamic range may start at 1024), so
 * a server that lands on one closes and listens again.
 */

import net from "node:net";

export const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

function wantsRandomPort(args: unknown[]): boolean {
  const first = args[0];
  if (first === 0 || first === "0") return true;
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const port = (first as { port?: unknown }).port;
    return port === 0 || port === "0";
  }
  return false;
}

const PATCHED = Symbol.for("termix.safePorts");

export function installSafePorts(): void {
  const proto = net.Server.prototype as net.Server & { [PATCHED]?: boolean };
  if (proto[PATCHED]) return;
  proto[PATCHED] = true;

  const listen = proto.listen as (
    this: net.Server,
    ...args: unknown[]
  ) => net.Server;
  proto.listen = function (this: net.Server, ...args: unknown[]) {
    if (wantsRandomPort(args)) retryOnBlockedPort(this, args);
    return listen.apply(this, args);
  } as typeof proto.listen;
}

function retryOnBlockedPort(server: net.Server, args: unknown[]): void {
  const emit = server.emit;
  // The caller's callback is already a pending "listening" listener, so a
  // retry leaves it out and it fires once, on the good port.
  const retryArgs = args.filter((arg) => typeof arg !== "function");
  server.emit = ((event: string | symbol, ...rest: unknown[]) => {
    if (event === "listening") {
      const address = server.address();
      if (
        address &&
        typeof address === "object" &&
        FETCH_BLOCKED_PORTS.has(address.port)
      ) {
        server.close(() => server.listen(...(retryArgs as [])));
        return true;
      }
      server.emit = emit;
    }
    return emit.call(server, event, ...rest);
  }) as typeof server.emit;
}
