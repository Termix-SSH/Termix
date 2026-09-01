import { beforeEach, describe, expect, it, vi } from "vitest";

const listOwnHostParentLinks = vi.fn();

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    listOwnHostParentLinks,
  }),
}));

describe("validateParentHostId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a host being set as its own parent", async () => {
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", 5, 5);
    expect(error).toMatch(/own parent/);
    expect(listOwnHostParentLinks).not.toHaveBeenCalled();
  });

  it("rejects a parent host that doesn't belong to the user", async () => {
    listOwnHostParentLinks.mockResolvedValue([
      { id: 1, parentHostId: null },
      { id: 2, parentHostId: null },
    ]);
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", 1, 99);
    expect(error).toMatch(/not found/);
  });

  it("accepts a valid, cycle-free parent assignment", async () => {
    listOwnHostParentLinks.mockResolvedValue([
      { id: 1, parentHostId: null },
      { id: 2, parentHostId: null },
    ]);
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", 2, 1);
    expect(error).toBeNull();
  });

  it("rejects assigning a host under its own descendant (direct cycle)", async () => {
    // Zeus (1) currently has VM (2) as a child; assigning Zeus under VM
    // would form a two-node cycle.
    listOwnHostParentLinks.mockResolvedValue([
      { id: 1, parentHostId: null },
      { id: 2, parentHostId: 1 },
    ]);
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", 1, 2);
    expect(error).toMatch(/descendant/);
  });

  it("rejects assigning a host under a deeper descendant (multi-level cycle)", async () => {
    // Zeus (1) -> VM (2) -> Nested (3); assigning Zeus under Nested must
    // also be rejected, not just the direct-child case.
    listOwnHostParentLinks.mockResolvedValue([
      { id: 1, parentHostId: null },
      { id: 2, parentHostId: 1 },
      { id: 3, parentHostId: 2 },
    ]);
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", 1, 3);
    expect(error).toMatch(/descendant/);
  });

  it("allows a create (no existing hostId) to target any owned host", async () => {
    listOwnHostParentLinks.mockResolvedValue([{ id: 1, parentHostId: null }]);
    const { validateParentHostId } =
      await import("../../../database/routes/host-parent-validation.js");

    const error = await validateParentHostId("user-1", null, 1);
    expect(error).toBeNull();
  });
});
