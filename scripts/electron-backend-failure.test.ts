import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyBackendFailure } =
  require("../electron/backend-failure.cjs") as {
    classifyBackendFailure: (input: {
      exitCode: number | null;
      signal?: string | null;
      stderr?: string;
    }) => { reason: string; port: number | null } | null;
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
  it("reports no failure for a clean exit", () => {
    expect(classifyBackendFailure({ exitCode: 0, stderr: "" })).toBeNull();
  });

  it("identifies a port conflict and the port it happened on", () => {
    expect(
      classifyBackendFailure({ exitCode: 1, stderr: EADDRINUSE_STDERR }),
    ).toEqual({ reason: "port-in-use", port: 30001 });
  });

  it("still reports a port conflict when the buffered stderr lost the numeric port field", () => {
    expect(
      classifyBackendFailure({
        exitCode: 1,
        stderr: "Error: listen EADDRINUSE: address already in use :::30001",
      }),
    ).toEqual({ reason: "port-in-use", port: 30001 });
  });

  it("falls back to a null port when EADDRINUSE carries no parsable port", () => {
    expect(
      classifyBackendFailure({ exitCode: 1, stderr: "code: 'EADDRINUSE'" }),
    ).toEqual({ reason: "port-in-use", port: null });
  });

  it("reports a generic crash for any other non-zero exit", () => {
    expect(
      classifyBackendFailure({ exitCode: 7, stderr: "TypeError: boom" }),
    ).toEqual({ reason: "crashed", port: null });
  });

  it("treats a signal kill as a crash even though the exit code is null", () => {
    expect(
      classifyBackendFailure({ exitCode: null, signal: "SIGSEGV", stderr: "" }),
    ).toEqual({ reason: "crashed", port: null });
  });

  it("does not report a failure when the process was shut down deliberately", () => {
    expect(
      classifyBackendFailure({ exitCode: null, signal: "SIGTERM", stderr: "" }),
    ).toBeNull();
  });
});
