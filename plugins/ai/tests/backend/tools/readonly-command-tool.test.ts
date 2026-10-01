import { describe, expect, it, vi } from "vitest";
import { availableTools, getTool } from "../../../src/backend/tools/catalog.js";
import type { ToolContext } from "../../../src/backend/tools/types.js";

const tool = getTool("run_readonly_command")!;

function contextWith(overrides: Partial<ToolContext> = {}) {
  const withConnection = vi.fn(async () => ({
    stdout: "Filesystem  Size",
    stderr: "",
    code: 0,
  }));
  const record = vi.fn(async () => {});
  const context = {
    userId: "user-1",
    conversationId: 1,
    allowReadOnlyCommands: true,
    deps: {
      hosts: {
        checkAccess: vi.fn(async () => ({ hasAccess: true })),
      },
      ssh: { withConnection },
      audit: { record },
    },
    ...overrides,
  } as unknown as ToolContext;
  return { context, withConnection, record };
}

describe("run_readonly_command", () => {
  it("is only offered to a user who opted in", () => {
    const names = (allow: boolean) =>
      availableTools(() => true, { allowReadOnlyCommands: allow }).map(
        (entry) => entry.name,
      );
    expect(names(false)).not.toContain("run_readonly_command");
    expect(names(true)).toContain("run_readonly_command");
  });

  it("runs an allowlisted command and audits it", async () => {
    const { context, withConnection, record } = contextWith();
    const result = await tool.handler({ hostId: 4, command: "df -h" }, context);
    expect(result).toEqual({ output: "Filesystem  Size" });
    expect(withConnection).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_readonly_command", success: true }),
    );
  });

  it("refuses a command that is not read-only", async () => {
    const { context, withConnection } = contextWith();
    const result = (await tool.handler(
      { hostId: 4, command: "rm -rf /tmp/x" },
      context,
    )) as { error?: string };
    expect(result.error).toBeTruthy();
    expect(withConnection).not.toHaveBeenCalled();
  });

  it("refuses when the user has not opted in, or cannot reach the host", async () => {
    const off = contextWith({ allowReadOnlyCommands: false });
    expect(
      await tool.handler({ hostId: 4, command: "uptime" }, off.context),
    ).toEqual({ error: "The user has not allowed read-only commands" });

    const denied = contextWith();
    (
      denied.context.deps.hosts.checkAccess as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ hasAccess: false });
    expect(
      await tool.handler({ hostId: 4, command: "uptime" }, denied.context),
    ).toEqual({ error: "Host not found" });
    expect(denied.withConnection).not.toHaveBeenCalled();
  });
});
