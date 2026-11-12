/**
 * The old worker broker believed a callerUserId the worker put on its own
 * messages. A sandboxed plugin only ever holds tokens core minted, and core
 * decides the actor from the token alone.
 */
import { describe, expect, it } from "vitest";
import { getActor, runAsActor } from "../../../plugins/actor.js";
import { SandboxedPlugin } from "../../../plugins/sandbox/host.js";
import type { Transport, Wire } from "../../../plugins/sandbox/rpc.js";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";

function harness(pluginId = "docker", tokens = new SandboxTokenStore()) {
  const toHost: Array<(m: Wire) => void> = [];
  const replies: Wire[] = [];
  const transport: Transport = {
    send: (m) => replies.push(structuredClone(m)),
    onMessage: (h) => toHost.push(h),
  };
  const ctx = {
    whoami: () => getActor() ?? null,
    asUser: <T>(userId: string, fn: () => T) =>
      runAsActor(userId, "asUser", fn),
  };
  const sandbox = new SandboxedPlugin(
    { id: pluginId, capabilities: [] } as never,
    "/nowhere",
    "/nowhere/index.js",
    ctx,
    { tokens },
  );
  sandbox.attach(transport);
  let id = 0;
  const send = async (m: Partial<Wire> & { t: "call" | "fn" }) => {
    const message = { id: ++id, a: [], ...m } as Wire;
    toHost.forEach((h) => h(message));
    await new Promise((r) => setTimeout(r, 5));
    return replies.find(
      (r) => "id" in r && r.id === (message as { id: number }).id,
    );
  };
  return { sandbox, tokens, send, replies };
}

describe("sandboxed plugin actor", () => {
  it("acts as the token's user, whatever the message claims", async () => {
    const { tokens, send } = harness();
    const token = tokens.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "request",
    });
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: token,
      u: "admin",
      a: [{ callerUserId: "admin", userId: "admin" }],
    } as never);
    expect(reply).toMatchObject({ t: "ok", v: "alice" });
  });

  it("refuses a made up token instead of running with no actor", async () => {
    const { send } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: "admin",
      u: "admin",
    } as never);
    expect(reply).toMatchObject({
      t: "err",
      e: { code: "SANDBOX_TOKEN", status: 403 },
    });
  });

  it("refuses another plugin's token", async () => {
    const shared = new SandboxTokenStore();
    const { send } = harness("docker", shared);
    const foreign = shared.mint({
      pluginId: "snippets",
      userId: "admin",
      kind: "request",
    });
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      k: foreign,
    } as never);
    expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_TOKEN" } });
  });

  it("refuses a request token replayed after it was revoked", async () => {
    const { tokens, send } = harness();
    const token = tokens.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "request",
    });
    tokens.revoke(token);
    const reply = await send({ t: "call", m: "ctx.whoami", k: token } as never);
    expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_TOKEN" } });
  });

  it("runs with no actor when no token is sent, the same as background work", async () => {
    const { send } = harness();
    const reply = await send({
      t: "call",
      m: "ctx.whoami",
      u: "admin",
    } as never);
    expect(reply).toMatchObject({ t: "ok", v: null });
  });

  it("only exposes methods that are on the real ctx", async () => {
    const { tokens, send } = harness();
    const token = tokens.mint({
      pluginId: "docker",
      userId: "alice",
      kind: "request",
    });
    for (const m of [
      "ctx.constructor",
      "ctx.__proto__",
      "ctx.whoami.call",
      "ctx.toString",
    ]) {
      const reply = await send({ t: "call", m, k: token } as never);
      expect(reply).toMatchObject({ t: "err", e: { code: "SANDBOX_UNKNOWN" } });
    }
  });

  it("mints a fresh token for the user core is acting as when it calls the plugin", async () => {
    const { sandbox, tokens } = harness();
    const token = runAsActor("bob", "request", () =>
      sandbox.mintForCurrentActor(),
    );
    expect(tokens.resolve(token, "docker")?.userId).toBe("bob");
  });
});
