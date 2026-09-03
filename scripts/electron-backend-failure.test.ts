import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyBackendFailure } =
  require("../electron/backend-failure.cjs") as {
    classifyBackendFailure: (stderr: string) => {
      reason: string;
      port: number | null;
    };
  };

const EADDRINUSE_STDERR = `[2:50:37 PM] [ERROR] [DB] Port 30001 is already in use. Kill the existing process and retry. [op:http_server_port_conflict]
Error: listen EADDRINUSE: address already in use :::30001
    at Server.setupListenHandle [as _listen2] (node:net:2009:16) {
  code: 'EADDRINUSE',
  errno: -98,
  syscall: 'listen',
  address: '::',
  port: 30001
}`;

describe("classifyBackendFailure", () => {
  // Only reached for exits stopBackendServer() did not ask for, so every
  // exit is a failure the renderer has to be told about: the process is
  // gone either way, and nothing ever restarts it.
  it("identifies a port conflict and the port it happened on", () => {
    expect(classifyBackendFailure(EADDRINUSE_STDERR)).toEqual({
      reason: "port-in-use",
      port: 30001,
    });
  });

  it("still reports a port conflict when the buffered stderr lost the numeric port field", () => {
    expect(
      classifyBackendFailure(
        "Error: listen EADDRINUSE: address already in use :::30001",
      ),
    ).toEqual({ reason: "port-in-use", port: 30001 });
  });

  it("falls back to a null port when EADDRINUSE carries no parsable port", () => {
    expect(classifyBackendFailure("code: 'EADDRINUSE'")).toEqual({
      reason: "port-in-use",
      port: null,
    });
  });

  it("reports a crash for any other non-zero exit", () => {
    expect(classifyBackendFailure("TypeError: boom")).toEqual({
      reason: "crashed",
      port: null,
    });
  });

  it("reports a crash for a signal kill, which leaves no stderr at all", () => {
    expect(classifyBackendFailure("")).toEqual({
      reason: "crashed",
      port: null,
    });
  });
});
