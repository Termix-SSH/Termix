import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import http from "http";
import type { AddressInfo } from "net";
import { listenOnServicePort } from "../../utils/service-listen.js";
import { Logger } from "../../utils/logger.js";

function testLogger() {
  const logger = new Logger("TEST", "🧪", "#000000");
  return {
    logger,
    error: vi.spyOn(logger, "error").mockImplementation(() => {}),
  };
}

function occupyPort(): Promise<{ port: number; release: () => void }> {
  return new Promise((resolve) => {
    const blocker = http.createServer();
    blocker.listen(0, "127.0.0.1", () => {
      resolve({
        port: (blocker.address() as AddressInfo).port,
        release: () => blocker.close(),
      });
    });
  });
}

const servers: http.Server[] = [];

afterEach(() => {
  while (servers.length) servers.pop()?.close();
  vi.restoreAllMocks();
});

describe("listenOnServicePort", () => {
  it("starts the service and reports listening on a free port", async () => {
    const { logger, error } = testLogger();
    const onListening = vi.fn();

    const server = listenOnServicePort({
      app: express(),
      port: 0,
      logger,
      serviceName: "test",
      onListening,
    });
    servers.push(server);

    await vi.waitFor(() => expect(onListening).toHaveBeenCalledOnce());
    expect(server.listening).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  // The bug this helper exists for: express's app.listen(port, host, cb)
  // registers cb as the server's error handler too, so a port conflict
  // invoked the "service started" callback and emitted nothing at all.
  it("does not report the service as started when the port is taken", async () => {
    const { port, release } = await occupyPort();
    const { logger } = testLogger();
    const onListening = vi.fn();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    const server = listenOnServicePort({
      app: express(),
      port,
      logger,
      serviceName: "test",
      onListening,
    });
    servers.push(server);

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(onListening).not.toHaveBeenCalled();
    release();
  });

  it("names the conflicting port so the desktop can surface it", async () => {
    const { port, release } = await occupyPort();
    const { logger, error } = testLogger();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    servers.push(
      listenOnServicePort({
        app: express(),
        port,
        logger,
        serviceName: "metrics",
      }),
    );

    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    const [message, , context] = error.mock.calls[0];
    expect(message).toContain(String(port));
    expect(context).toMatchObject({
      operation: "service_port_conflict",
      port,
      service: "metrics",
    });
    release();
  });

  it("leaves any other listen error to the process-level handlers", async () => {
    const { logger } = testLogger();
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    const server = listenOnServicePort({
      app: express(),
      port: 0,
      logger,
      serviceName: "test",
    });
    servers.push(server);

    const notPortConflict = Object.assign(new Error("boom"), { code: "EPERM" });
    expect(() => server.emit("error", notPortConflict)).toThrow("boom");
    expect(exit).not.toHaveBeenCalled();
  });
});

// express's app.listen() swallows a bind failure by design (see
// service-listen.ts), so no service may reach for it again.
describe("backend services", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === "tests" ? [] : sourceFiles(full);
      }
      return full.endsWith(".ts") ? [full] : [];
    });
  }

  it("never bind a port with express's app.listen()", () => {
    const offenders = sourceFiles(path.resolve("src/backend"))
      // service-listen.ts names the call only to document why it is banned.
      .filter((file) => !file.endsWith(path.join("utils", "service-listen.ts")))
      .filter((file) => /\bapp\.listen\(/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});
