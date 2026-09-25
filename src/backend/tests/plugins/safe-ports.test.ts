import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FETCH_BLOCKED_PORTS,
  installSafePorts,
} from "../../../../packages/plugin-sdk/src/testing/safe-ports.js";

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) =>
    server?.listening ? server.close(() => resolve()) : resolve(),
  );
  server = null;
});

describe("installSafePorts", () => {
  it("listens again when the random port is one fetch refuses", async () => {
    installSafePorts();
    server = http.createServer((_req, res) => res.end("ok"));
    const realAddress = server.address.bind(server);
    vi.spyOn(server, "address").mockImplementationOnce(() => ({
      address: "127.0.0.1",
      family: "IPv4",
      port: 6000,
    }));
    const onListening = vi.fn();

    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", () => {
        onListening();
        resolve();
      }),
    );

    expect(onListening).toHaveBeenCalledTimes(1);
    const { port } = realAddress() as AddressInfo;
    expect(FETCH_BLOCKED_PORTS.has(port)).toBe(false);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe("ok");
  });

  it("leaves a fixed port alone", async () => {
    installSafePorts();
    server = http.createServer();
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    server = http.createServer();
    await new Promise<void>((resolve) => server!.listen(port, resolve));
    expect((server.address() as AddressInfo).port).toBe(port);
  });
});
