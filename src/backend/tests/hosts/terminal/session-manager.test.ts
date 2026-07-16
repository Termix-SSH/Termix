import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub all external imports before loading the module under test
const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
const mockUpdateEnded = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../database/db/index.js", () => ({
  getDb: () => ({}),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSessionRecordingRepository: () => ({
    create: mockCreate,
    updateEnded: mockUpdateEnded,
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock individual fs.promises methods via a stub object
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockAppendFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      appendFile: mockAppendFile,
      readFile: vi.fn(),
      unlink: mockUnlink,
    },
  },
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    appendFile: mockAppendFile,
    readFile: vi.fn(),
    unlink: mockUnlink,
  },
}));

const { sessionManager } =
  await import("../../../hosts/terminal/session-manager.js");

describe("TerminalSessionManager - session logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply resolved values after clearAllMocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ id: 1 });
    mockUpdateEnded.mockResolvedValue(undefined);
  });

  it("createSession stores sessionLoggingEnabled=true by default", () => {
    const id = sessionManager.createSession("u1", 1, "host", 80, 24);
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(true);
    sessionManager.destroySession(id);
  });

  it("createSession stores sessionLoggingEnabled=false when passed", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const session = sessionManager.getSession(id);
    expect(session?.sessionLoggingEnabled).toBe(false);
    sessionManager.destroySession(id);
  });

  it("does not write log file when sessionLoggingEnabled=false", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    sessionManager.bufferOutput(id, "some output");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writes log file and inserts DB row when sessionLoggingEnabled=true", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.bufferOutput(id, "terminal output data");
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("does not write log file when buffer is empty", async () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      true,
    );
    sessionManager.destroySession(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("bufferOutput trims old data when exceeding 512KB", () => {
    const id = sessionManager.createSession(
      "u1",
      1,
      "host",
      80,
      24,
      undefined,
      false,
    );
    const chunk = "x".repeat(300 * 1024);
    sessionManager.bufferOutput(id, chunk);
    sessionManager.bufferOutput(id, chunk);
    const session = sessionManager.getSession(id);
    expect(session!.outputBufferBytes).toBeLessThanOrEqual(512 * 1024);
    sessionManager.destroySession(id);
  });
});
