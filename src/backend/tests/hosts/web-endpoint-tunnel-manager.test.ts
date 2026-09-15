import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Exercises establishDirectTunnel's local branch against a REAL TCP listener.
 * The two behaviours here are the ones a mocked test cannot show:
 *
 *  - under sourcePort 0 the kernel assigns the port, so the runtime has to
 *    record what it actually bound rather than the 0 it was asked for; and
 *  - an idle tunnel closes itself and REMOVES its runtime entry, so nothing
 *    keeps handing out a port whose listener is gone.
 *
 * The SSH half is stubbed -- these behaviours live entirely in the listener
 * and the runtime bookkeeping.
 */
const sshPrimitives = vi.hoisted(() => ({
  forwardOut: vi.fn(async () => {
    throw new Error("not used in these tests");
  }),
  pipeTunnelStreams: vi.fn(),
  handleSocks5Connect: vi.fn(),
}));
vi.mock("../../hosts/tunnel/ssh-primitives.js", () => sshPrimitives);

function tunnelConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: "web:7:e1",
    scope: "s2s",
    mode: "local",
    tunnelType: "local",
    bindHost: "127.0.0.1",
    sourcePort: 0,
    endpointHost: "127.0.0.1",
    endpointPort: 9,
    ...overrides,
  } as never;
}

const fakeClient = () => ({ on: vi.fn(), end: vi.fn() }) as never;

afterEach(() => {
  vi.resetModules();
});

describe("establishDirectTunnel records the port it actually bound", () => {
  it("reports the kernel-assigned port, never the requested 0", async () => {
    const manager = await import("../../hosts/tunnel/manager.js");
    await manager.establishDirectTunnel(fakeClient(), tunnelConfig());

    const runtime = manager.activeTunnelRuntimes.get("web:7:e1");
    expect(runtime).toBeDefined();
    // The whole point: 0 means "pick one for me", so a runtime advertising 0
    // would make every caller that reuses the port fail.
    expect(runtime?.bindPort).toBeGreaterThan(0);

    // And it is genuinely listening there.
    const port = runtime!.bindPort as number;
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    });

    runtime?.close();
    manager.activeTunnelRuntimes.delete("web:7:e1");
  });

  it("honours a fixed source port when one is asked for", async () => {
    const manager = await import("../../hosts/tunnel/manager.js");
    // Borrow a free port, release it, then ask for it explicitly.
    const probe = net.createServer();
    const wanted = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () =>
        resolve((probe.address() as { port: number }).port),
      );
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await manager.establishDirectTunnel(
      fakeClient(),
      tunnelConfig({ name: "web:7:fixed", sourcePort: wanted }),
    );
    const runtime = manager.activeTunnelRuntimes.get("web:7:fixed");
    expect(runtime?.bindPort).toBe(wanted);

    runtime?.close();
    manager.activeTunnelRuntimes.delete("web:7:fixed");
  });
});

describe("idle close", () => {
  it("removes the runtime entry, not just the listener", async () => {
    // Real timers deliberately: establishDirectTunnel awaits real socket I/O,
    // and mixing fake timers with that is a known route to a hanging test.
    const manager = await import("../../hosts/tunnel/manager.js");
    await manager.establishDirectTunnel(
      fakeClient(),
      tunnelConfig({ name: "web:7:idle", idleTimeoutMs: 60 }),
    );
    expect(manager.activeTunnelRuntimes.has("web:7:idle")).toBe(true);

    await vi.waitFor(
      () => {
        // Deleting the entry is the assertion. close() alone would stop the
        // listener but leave the entry behind, so the open route would keep
        // returning a port nothing is listening on.
        expect(manager.activeTunnelRuntimes.has("web:7:idle")).toBe(false);
      },
      { timeout: 4000, interval: 25 },
    );
  });

  it("leaves a tunnel with no idle timeout running", async () => {
    // Without this, an idle-close bug that fires unconditionally would still
    // pass the test above.
    const manager = await import("../../hosts/tunnel/manager.js");
    await manager.establishDirectTunnel(
      fakeClient(),
      tunnelConfig({ name: "web:7:forever" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(manager.activeTunnelRuntimes.has("web:7:forever")).toBe(true);

    manager.activeTunnelRuntimes.get("web:7:forever")?.close();
    manager.activeTunnelRuntimes.delete("web:7:forever");
  });
});
