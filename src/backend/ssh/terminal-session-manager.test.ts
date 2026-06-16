import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub all external imports before loading the module under test
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

vi.mock("../database/db/index.js", () => ({
  getDb: () => ({
    $client: {
      prepare: () => ({ get: () => undefined }),
    },
    insert: mockInsert,
  }),
}));

vi.mock("../database/db/schema.js", () => ({
  sessionRecordings: {},
}));

vi.mock("../utils/logger.js", () => ({
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

vi.mock("fs", () => ({
  default: {
    promises: {
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      readFile: vi.fn(),
      unlink: vi.fn(),
    },
  },
  promises: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

const { sessionManager } = await import("./terminal-session-manager.js");

describe("TerminalSessionManager - session logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply resolved values after clearAllMocks
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockInsertValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockInsertValues });
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
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
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
