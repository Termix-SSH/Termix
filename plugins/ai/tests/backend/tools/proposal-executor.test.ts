import { beforeEach, describe, expect, it, vi } from "vitest";

const execCommand = vi.fn();
vi.mock("@termix/plugin-sdk/host-commands", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

const { applyProposal } =
  await import("../../../src/backend/tools/executor.js");

const hosts = {
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  checkAccess: vi.fn(),
};
const automationsAccess = { create: vi.fn() };
const fleetsAccess = { create: vi.fn(), addMember: vi.fn() };
const snippetsAccess = {
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};
const withConnection = vi.fn(
  async (
    _host: unknown,
    _options: unknown,
    run: (client: unknown) => unknown,
  ) => run({}),
);

let provided: Record<string, object> = {};
let granted = new Set<string>();

/** What the executor gets from ctx: the approving user's view of core. */
function deps() {
  return {
    hosts,
    services: {
      providers: (service: string) => (service in provided ? [""] : []),
      get: (service: string) => provided[service],
    },
    rbac: { has: async (permission: string) => granted.has(permission) },
    ssh: { withConnection },
    notify: {},
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  provided = {};
  granted = new Set(["hosts.create", "hosts.edit"]);
});

describe("applyProposal", () => {
  it("refuses a kind that is not a real tool", async () => {
    // The stored payload is treated as untrusted even though the server wrote
    // it, because a proposal can outlive the release that created it.
    await expect(
      applyProposal("propose_delete_everything", {}, deps()),
    ).rejects.toThrow("Unknown proposal kind");
  });

  it("hands an automation to the automations plugin, which validates it", async () => {
    provided["automations.access"] = automationsAccess;
    automationsAccess.create.mockRejectedValue(
      new Error("Unknown or missing trigger kind"),
    );
    await expect(
      applyProposal(
        "propose_create_automation",
        {
          name: "bad",
          definition: { trigger: { kind: "nonsense" }, steps: [] },
        },
        deps(),
      ),
    ).rejects.toThrow("Unknown or missing trigger kind");
  });

  it("refuses an automation while the automations plugin is off", async () => {
    await expect(
      applyProposal(
        "propose_create_automation",
        { name: "x", definition: {} },
        deps(),
      ),
    ).rejects.toThrow("The automations plugin is not available");
  });

  it("creates a valid automation disabled so it cannot fire unwatched", async () => {
    provided["automations.access"] = automationsAccess;
    automationsAccess.create.mockResolvedValue({ id: 5, name: "nightly" });

    const result = await applyProposal(
      "propose_create_automation",
      {
        name: "nightly",
        definition: {
          trigger: { kind: "schedule", intervalSeconds: 3600 },
          steps: [{ id: "s1", type: "wait", seconds: 1 }],
        },
      },
      deps(),
    );

    expect(result.ok).toBe(true);
    expect(automationsAccess.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "nightly", enabled: false }),
    );
  });

  it("runs an approved command through ctx.ssh on the host id", async () => {
    // ctx.ssh resolves the host for the approving user, with the connect
    // access check, so the executor never holds a host row itself.
    execCommand.mockResolvedValue({ stdout: "up 3 days", stderr: "", code: 0 });

    const result = await applyProposal(
      "propose_run_command",
      { hostId: 9, command: "uptime" },
      deps(),
    );

    expect(withConnection).toHaveBeenCalledWith(
      9,
      { pool: "ai", purpose: "fleet" },
      expect.any(Function),
    );
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("up 3 days");
  });

  it("fails when the user cannot reach the host", async () => {
    withConnection.mockRejectedValueOnce(new Error("Host not found"));

    await expect(
      applyProposal(
        "propose_run_command",
        { hostId: 9, command: "uptime" },
        deps(),
      ),
    ).rejects.toThrow("Host not found");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("surfaces a non-zero exit rather than reporting success", async () => {
    execCommand.mockResolvedValue({ stdout: "", stderr: "denied", code: 1 });

    await expect(
      applyProposal(
        "propose_run_command",
        { hostId: 9, command: "cat /etc/shadow" },
        deps(),
      ),
    ).rejects.toThrow("code 1");
  });

  it("creates a host through ctx.hosts, with tags as core stores them", async () => {
    hosts.create.mockResolvedValue({ id: 7, name: "web-1" });

    const result = await applyProposal(
      "propose_create_host",
      { name: "web-1", ip: "10.0.0.5", port: 22, tags: ["prod", "eu"] },
      deps(),
    );

    expect(result.ok).toBe(true);
    expect(hosts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "web-1",
        ip: "10.0.0.5",
        tags: "prod,eu",
      }),
    );
  });

  it("refuses to create a host without hosts.create", async () => {
    granted = new Set();
    await expect(
      applyProposal(
        "propose_create_host",
        { name: "web-1", ip: "10.0.0.5" },
        deps(),
      ),
    ).rejects.toThrow("permission");
    expect(hosts.create).not.toHaveBeenCalled();
  });

  it("rejects a host payload missing required fields", async () => {
    await expect(
      applyProposal("propose_create_host", { name: "web-1" }, deps()),
    ).rejects.toThrow("ip is required");
    expect(hosts.create).not.toHaveBeenCalled();
  });

  it("updates through ctx.hosts, which refuses a host the user does not own", async () => {
    hosts.update.mockResolvedValue(null);

    await expect(
      applyProposal(
        "propose_update_host",
        { hostId: 999, changes: { name: "x" } },
        deps(),
      ),
    ).rejects.toThrow("Host not found");
    expect(hosts.update).toHaveBeenCalledWith(999, { name: "x" });
  });

  it("rejects a non-numeric id rather than coercing it", async () => {
    await expect(
      applyProposal(
        "propose_update_host",
        { hostId: "7; DROP TABLE hosts", changes: { name: "x" } },
        deps(),
      ),
    ).rejects.toThrow("hostId must be a positive integer");
  });

  it("reports nothing to change on an empty update", async () => {
    const result = await applyProposal(
      "propose_update_host",
      { hostId: 7, changes: {} },
      deps(),
    );

    expect(result.ok).toBe(false);
    expect(hosts.update).not.toHaveBeenCalled();
  });

  it("deletes through ctx.hosts", async () => {
    hosts.delete.mockResolvedValue(true);
    const result = await applyProposal(
      "propose_delete_host",
      { hostId: 7, reason: "old" },
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(hosts.delete).toHaveBeenCalledWith(7);
  });

  it("only adds fleet members the approving user owns", async () => {
    provided["fleets.access"] = fleetsAccess;
    fleetsAccess.create.mockResolvedValue({ id: 3, name: "prod" });
    hosts.checkAccess.mockImplementation(async (hostId: number) => ({
      hasAccess: true,
      isOwner: hostId === 1,
      isShared: hostId !== 1,
    }));

    const result = await applyProposal(
      "propose_create_fleet",
      { name: "prod", hostIds: [1, 2] },
      deps(),
    );

    expect(fleetsAccess.addMember).toHaveBeenCalledTimes(1);
    expect(fleetsAccess.addMember).toHaveBeenCalledWith(3, 1);
    expect(result.summary).toContain("1 host");
  });

  it("fails clearly when the fleets plugin is off", async () => {
    await expect(
      applyProposal("propose_create_fleet", { name: "prod" }, deps()),
    ).rejects.toThrow("The fleets plugin is not available");
  });

  it("edits a snippet through the snippets plugin", async () => {
    provided["snippets.access"] = snippetsAccess;
    snippetsAccess.get.mockResolvedValue({ id: 4, name: "a" });

    await applyProposal(
      "propose_update_snippet",
      { snippetId: 4, changes: { name: "b" } },
      deps(),
    );

    expect(snippetsAccess.update).toHaveBeenCalledWith(4, { name: "b" });
  });
});
