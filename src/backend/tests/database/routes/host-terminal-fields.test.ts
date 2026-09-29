import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stored: null as Record<string, unknown> | null,
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostById: async () => state.stored,
  }),
}));

const { mergeStoredTerminalFields, parseTerminalConfig } =
  await import("../../../database/routes/host-terminal-fields.js");

beforeEach(() => {
  state.stored = {
    terminalConfig: JSON.stringify({
      theme: "nord",
      sudoPassword: "legacy-sudo",
      agentSocketPath: "/owner/agent",
      startupSnippetId: 1,
    }),
    sshOptions: JSON.stringify({ agentSocketPath: "/owner/agent" }),
  };
});

async function merge(
  hostData: Record<string, unknown>,
  isOwner = true,
  sshOptions?: string,
) {
  const row: Record<string, unknown> = {
    terminalConfig: "replaced wholesale",
    ...(sshOptions !== undefined ? { sshOptions } : {}),
  };
  const error = await mergeStoredTerminalFields(row, hostData, 1, "o", isOwner);
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

describe("mergeStoredTerminalFields", () => {
  it("merges an editor save into the stored 2.8 keys instead of dropping them", async () => {
    const { error, row } = await merge({
      terminalConfig: { startupSnippetId: 4 },
    });
    expect(error).toBeNull();
    expect(JSON.parse(row.terminalConfig as string)).toEqual({
      theme: "nord",
      sudoPassword: "legacy-sudo",
      agentSocketPath: "/owner/agent",
      startupSnippetId: 4,
    });
  });

  it("leaves terminal_config alone when the payload has none", async () => {
    const { row } = await merge({});
    expect(row).not.toHaveProperty("terminalConfig");
  });

  it("drops the legacy sudo copy once the owner saves one on its own", async () => {
    const { row } = await merge({ sudoPassword: "" });
    expect(JSON.parse(row.terminalConfig as string)).not.toHaveProperty(
      "sudoPassword",
    );
  });

  it("keeps the owner's private keys through a shared editor's save", async () => {
    const { row } = await merge(
      { terminalConfig: { startupSnippetId: 2 } },
      false,
      JSON.stringify({ keepaliveInterval: 9 }),
    );
    expect(JSON.parse(row.terminalConfig as string)).toMatchObject({
      sudoPassword: "legacy-sudo",
      agentSocketPath: "/owner/agent",
      startupSnippetId: 2,
    });
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
