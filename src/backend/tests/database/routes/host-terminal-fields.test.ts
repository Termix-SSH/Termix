import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostById: async () => state.stored,
  }),
}));

const { mergeStoredSshOptions, parseTerminalConfig } =
  await import("../../../database/routes/host-terminal-fields.js");

beforeEach(() => {
  state.stored = {
    sshOptions: JSON.stringify({ agentSocketPath: "/owner/agent" }),
  };
});

async function merge(
  hostData: Record<string, unknown>,
  isOwner = true,
  sshOptions?: string,
) {
  const row: Record<string, unknown> = {
    terminalConfig: "from the payload",
    ...(sshOptions !== undefined ? { sshOptions } : {}),
  };
  const error = await mergeStoredSshOptions(row, hostData, 1, "o", isOwner);
  return { error, row };
}

describe("parseTerminalConfig", () => {
  it("reads objects and JSON, and nothing else", () => {
    expect(parseTerminalConfig({ a: 1 })).toEqual({ a: 1 });
    expect(parseTerminalConfig('{"a":1}')).toEqual({ a: 1 });
    expect(parseTerminalConfig("nope")).toBeNull();
    expect(parseTerminalConfig([1])).toBeNull();
  });
});

describe("mergeStoredSshOptions", () => {
  it("never writes terminalConfig, which has no column", async () => {
    const { error, row } = await merge({
      terminalConfig: { startupSnippetId: 4 },
    });
    expect(error).toBeNull();
    expect(row).not.toHaveProperty("terminalConfig");
  });

  it("leaves an owner's SSH options as sent", async () => {
    const { row } = await merge(
      {},
      true,
      JSON.stringify({ agentSocketPath: "/x" }),
    );
    expect(JSON.parse(row.sshOptions as string)).toEqual({
      agentSocketPath: "/x",
    });
  });

  it("keeps the owner's private SSH options through a shared editor's save", async () => {
    const { row } = await merge(
      {},
      false,
      JSON.stringify({ keepaliveInterval: 9, agentSocketPath: "/editor" }),
    );
    expect(JSON.parse(row.sshOptions as string)).toEqual({
      keepaliveInterval: 9,
      agentSocketPath: "/owner/agent",
    });
  });

  it("refuses a terminalConfig it cannot read", async () => {
    const { error } = await merge({ terminalConfig: "not json" });
    expect(error).toBe("Invalid terminal config");
  });
});
