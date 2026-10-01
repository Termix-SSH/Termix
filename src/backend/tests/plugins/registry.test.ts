import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRegistry,
  consume,
  has,
  provide,
  revoke,
} from "../../plugins/registry.js";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("service registry", () => {
  afterEach(() => clearRegistry());

  it("round-trips a provider", () => {
    const pool = { name: "ssh-pool" };
    provide("ssh.transport", pool);

    expect(has("ssh.transport")).toBe(true);
    expect(consume<typeof pool>("ssh.transport")).toBe(pool);
  });

  it("returns undefined rather than throwing for a missing provider", () => {
    // Callers have to cope with a provider disappearing when its plugin is
    // disabled, so this is the contract rather than an error.
    expect(consume("nothing.here")).toBeUndefined();
    expect(has("nothing.here")).toBe(false);
  });

  it("replaces an existing provider", () => {
    provide("ssh.transport", { id: 1 });
    provide("ssh.transport", { id: 2 });
    expect(consume<{ id: number }>("ssh.transport")?.id).toBe(2);
  });

  it("only revokes the value that is actually registered", () => {
    const first = { id: 1 };
    const second = { id: 2 };

    provide("terminal.sessions", first);
    provide("terminal.sessions", second);

    // A crashed-and-restarted plugin must not revoke the replacement its own
    // restart installed.
    expect(revoke("terminal.sessions", first)).toBe(false);
    expect(consume("terminal.sessions")).toBe(second);

    expect(revoke("terminal.sessions", second)).toBe(true);
    expect(consume("terminal.sessions")).toBeUndefined();
  });

  it("revokes unconditionally when no value is given", () => {
    provide("terminal.sessions", { id: 1 });
    expect(revoke("terminal.sessions")).toBe(true);
    expect(has("terminal.sessions")).toBe(false);
  });

  it("reports a revoke of something never registered", () => {
    expect(revoke("nothing.here")).toBe(false);
  });
});
