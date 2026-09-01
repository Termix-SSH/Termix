import { beforeEach, describe, expect, it, vi } from "vitest";

const hostRepository = {
  create: vi.fn(),
  findByIdForUser: vi.fn(),
  updateForUser: vi.fn(),
  deleteForUser: vi.fn(),
};
const snippetRepository = {
  createSnippet: vi.fn(),
  findOwnedById: vi.fn(),
  updateSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
};
const fleetRepository = { create: vi.fn(), addMember: vi.fn() };
const alertRepository = { createAlertRule: vi.fn() };
const automationRepository = { create: vi.fn() };

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostRepository: () => hostRepository,
  createCurrentSnippetRepository: () => snippetRepository,
  createCurrentFleetRepository: () => fleetRepository,
  createCurrentAlertRepository: () => alertRepository,
  createCurrentAutomationRepository: () => automationRepository,
}));

const resolveHostById = vi.fn();
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: (...args: unknown[]) => resolveHostById(...args),
}));

const execCommand = vi.fn();
vi.mock("../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));
vi.mock("../../hosts/ssh-client-factory.js", () => ({
  createFleetSshFactory: () => () => ({}),
  getFleetPoolKey: () => "pool",
}));
vi.mock("../../hosts/ssh-connection-pool.js", () => ({
  withConnection: async (
    _key: string,
    _factory: unknown,
    run: (client: unknown) => Promise<unknown>,
  ) => run({}),
}));

const { applyProposal } = await import("../../ai/tools/executor.js");

describe("applyProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a kind that is not a real tool", async () => {
    // The stored payload is treated as untrusted even though the server wrote
    // it, because a proposal can outlive the release that created it.
    await expect(
      applyProposal("propose_delete_everything", {}, "user-1"),
    ).rejects.toThrow("Unknown proposal kind");
  });

  it("validates an automation definition before creating it", async () => {
    // Reuses the automations route's own validator, so a definition the model
    // invented is held to the same standard as a hand-written one.
    await expect(
      applyProposal(
        "propose_create_automation",
        {
          name: "bad",
          definition: { trigger: { kind: "nonsense" }, steps: [] },
        },
        "user-1",
      ),
    ).rejects.toThrow();
    expect(automationRepository.create).not.toHaveBeenCalled();
  });

  it("creates a valid automation disabled so it cannot fire unwatched", async () => {
    automationRepository.create.mockResolvedValue({ id: 5, name: "nightly" });

    const result = await applyProposal(
      "propose_create_automation",
      {
        name: "nightly",
        definition: {
          trigger: { kind: "schedule", intervalSeconds: 3600 },
          steps: [{ id: "s1", type: "wait", seconds: 1 }],
        },
      },
      "user-1",
    );

    expect(result.ok).toBe(true);
    expect(automationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", enabled: false }),
    );
  });

  it("runs an approved command only on a host the user can reach", async () => {
    // resolveHostById returns null when the connect-level permission check
    // fails, so an unreachable host never gets as far as an SSH attempt.
    resolveHostById.mockResolvedValue(null);

    await expect(
      applyProposal(
        "propose_run_command",
        { hostId: 9, command: "uptime" },
        "user-1",
      ),
    ).rejects.toThrow("Host not found");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("returns command output on success", async () => {
    resolveHostById.mockResolvedValue({ id: 9, ip: "10.0.0.9" });
    execCommand.mockResolvedValue({ stdout: "up 3 days", stderr: "", code: 0 });

    const result = await applyProposal(
      "propose_run_command",
      { hostId: 9, command: "uptime" },
      "user-1",
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("up 3 days");
  });

  it("resolves the host rather than using a raw repository row", async () => {
    // A raw row has no decrypted auth and an unresolved jumpHosts field, which
    // made the SSH factory fail with a jump host error on hosts that have none.
    resolveHostById.mockResolvedValue({ id: 9, ip: "10.0.0.9" });
    execCommand.mockResolvedValue({ stdout: "ok", stderr: "", code: 0 });

    await applyProposal(
      "propose_run_command",
      { hostId: 9, command: "uptime" },
      "user-1",
    );

    expect(resolveHostById).toHaveBeenCalledWith(9, "user-1");
    expect(hostRepository.findByIdForUser).not.toHaveBeenCalled();
  });

  it("surfaces a non-zero exit rather than reporting success", async () => {
    resolveHostById.mockResolvedValue({ id: 9, ip: "10.0.0.9" });
    execCommand.mockResolvedValue({ stdout: "", stderr: "denied", code: 1 });

    await expect(
      applyProposal(
        "propose_run_command",
        { hostId: 9, command: "cat /etc/shadow" },
        "user-1",
      ),
    ).rejects.toThrow("code 1");
  });

  it("creates a host through the normal repository", async () => {
    hostRepository.create.mockResolvedValue({ id: 7, name: "web-1" });

    const result = await applyProposal(
      "propose_create_host",
      { name: "web-1", ip: "10.0.0.5", port: 22, tags: ["prod"] },
      "user-1",
    );

    expect(result.ok).toBe(true);
    expect(hostRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        name: "web-1",
        ip: "10.0.0.5",
      }),
    );
  });

  it("rejects a host payload missing required fields", async () => {
    await expect(
      applyProposal("propose_create_host", { name: "web-1" }, "user-1"),
    ).rejects.toThrow("ip is required");
    expect(hostRepository.create).not.toHaveBeenCalled();
  });

  it("scopes an update to the approving user", async () => {
    hostRepository.findByIdForUser.mockResolvedValue({ id: 7 });
    hostRepository.updateForUser.mockResolvedValue({ id: 7 });

    await applyProposal(
      "propose_update_host",
      { hostId: 7, changes: { name: "renamed" } },
      "user-1",
    );

    expect(hostRepository.findByIdForUser).toHaveBeenCalledWith("user-1", 7);
    expect(hostRepository.updateForUser).toHaveBeenCalledWith(
      "user-1",
      7,
      expect.objectContaining({ name: "renamed" }),
    );
  });

  it("refuses to update a host the user does not own", async () => {
    hostRepository.findByIdForUser.mockResolvedValue(null);

    await expect(
      applyProposal(
        "propose_update_host",
        { hostId: 999, changes: { name: "x" } },
        "user-1",
      ),
    ).rejects.toThrow("Host not found");
    expect(hostRepository.updateForUser).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id rather than coercing it", async () => {
    await expect(
      applyProposal(
        "propose_update_host",
        { hostId: "7; DROP TABLE hosts", changes: { name: "x" } },
        "user-1",
      ),
    ).rejects.toThrow("hostId must be a positive integer");
  });

  it("only adds fleet members the approving user owns", async () => {
    fleetRepository.create.mockResolvedValue({ id: 3, name: "prod" });
    hostRepository.findByIdForUser.mockImplementation(
      async (_userId: string, hostId: number) =>
        hostId === 1 ? { id: 1 } : null,
    );

    const result = await applyProposal(
      "propose_create_fleet",
      { name: "prod", hostIds: [1, 2] },
      "user-1",
    );

    expect(fleetRepository.addMember).toHaveBeenCalledTimes(1);
    expect(fleetRepository.addMember).toHaveBeenCalledWith(3, 1);
    expect(result.summary).toContain("1 host");
  });

  it("reports nothing to change on an empty update", async () => {
    hostRepository.findByIdForUser.mockResolvedValue({ id: 7 });

    const result = await applyProposal(
      "propose_update_host",
      { hostId: 7, changes: {} },
      "user-1",
    );

    expect(result.ok).toBe(false);
    expect(hostRepository.updateForUser).not.toHaveBeenCalled();
  });
});
