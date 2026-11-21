/**
 * An ssh agent host in a plugin process: the agent stays in core and the
 * plugin's ssh2 client gets a relay that lists its keys and asks for each
 * signature (#1844).
 */
import ssh2 from "ssh2";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async () => true,
}));

import {
  agentRelay,
  relayedAgent,
  type AgentRelay,
} from "../../../plugins/sandbox/agent-relay.js";
import { PluginBridge } from "../../../plugins/sandbox/bridge.js";
import {
  Endpoint,
  type Transport,
  type Wire,
} from "../../../plugins/sandbox/rpc.js";
import { SandboxTokenStore } from "../../../plugins/sandbox/tokens.js";

// ssh2 makes an ed25519 key it can't read back about once in 300 tries.
function key(): ssh2.ParsedKey {
  for (;;) {
    const pair = ssh2.utils.generateKeyPairSync("ed25519");
    const parsed = ssh2.utils.parseKey(pair.private);
    if (!(parsed instanceof Error)) return parsed;
  }
}

class TestAgent extends ssh2.BaseAgent {
  signed = 0;
  constructor(private keys: ssh2.ParsedKey[]) {
    super();
  }
  getIdentities(
    cb: (err: Error | undefined, keys?: ssh2.ParsedKey[]) => void,
  ): void {
    cb(undefined, this.keys);
  }
  sign(
    pubKey: ssh2.ParsedKey | Buffer | string,
    data: Buffer,
    optionsOrCb: ssh2.SigningRequestOptions | ssh2.SignCallback,
    cb?: ssh2.SignCallback,
  ): void {
    const done = (typeof optionsOrCb === "function" ? optionsOrCb : cb)!;
    const blob = (pubKey as ssh2.ParsedKey).getPublicSSH();
    const match = this.keys.find((k) => k.getPublicSSH().equals(blob));
    if (!match) return done(new Error("no such key"));
    this.signed++;
    done(undefined, match.sign(data) as Buffer);
  }
}

function signWith(
  agent: ssh2.BaseAgent,
  pub: ssh2.ParsedKey,
  data: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    agent.sign(pub, data, {}, (err, sig) =>
      err ? reject(err) : resolve(sig as Buffer),
    ),
  );
}

function identities(agent: ssh2.BaseAgent): Promise<ssh2.ParsedKey[]> {
  return new Promise((resolve, reject) =>
    agent.getIdentities((err, keys) =>
      err ? reject(err) : resolve((keys ?? []) as ssh2.ParsedKey[]),
    ),
  );
}

describe("agent relay", () => {
  it("lists the agent's keys and signs with them", async () => {
    const held = key();
    const agent = relayedAgent(agentRelay(new TestAgent([held]))!);
    expect(agent).toBeInstanceOf(ssh2.BaseAgent);

    const keys = await identities(agent);
    expect(keys).toHaveLength(1);
    expect(keys[0].getPublicSSH().equals(held.getPublicSSH())).toBe(true);

    const data = Buffer.from("session data");
    const sig = await signWith(agent, keys[0], data);
    expect(held.verify(data, sig)).toBe(true);
  });

  it("refuses to sign with a key the agent did not list", async () => {
    const inner = new TestAgent([key()]);
    const relay = agentRelay(inner)!;
    await relay.identities();
    const other = key();
    await expect(
      relay.sign(other.getPublicSSH(), Buffer.from("x")),
    ).rejects.toThrow("can't sign");
    expect(inner.signed).toBe(0);
  });

  it("refuses before the keys were listed", async () => {
    const held = key();
    const relay = agentRelay(new TestAgent([held]))!;
    await expect(
      relay.sign(held.getPublicSSH(), Buffer.from("x")),
    ).rejects.toThrow("can't sign");
  });

  it("ignores values that are not agents", () => {
    expect(agentRelay(undefined)).toBeNull();
    expect(agentRelay("/tmp/agent.sock")).toBeNull();
    expect(agentRelay({ getIdentities: () => {} })).toBeNull();
  });
});

describe("ssh.prepare with an agent host", () => {
  it("sends a relay instead of dropping the agent", async () => {
    const hostHandlers: Array<(m: Wire) => void> = [];
    const childHandlers: Array<(m: Wire) => void> = [];
    const hostTransport: Transport = {
      send: (m) => {
        const copy = structuredClone(m);
        setImmediate(() => childHandlers.forEach((h) => h(copy)));
      },
      onMessage: (h) => hostHandlers.push(h),
    };
    const childTransport: Transport = {
      send: (m) => {
        const copy = structuredClone(m);
        setImmediate(() => hostHandlers.forEach((h) => h(copy)));
      },
      onMessage: (h) => childHandlers.push(h),
    };
    const held = key();
    const ctx = {
      pluginId: "term",
      log: { info: () => {}, error: () => {} },
      ssh: {
        prepare: vi.fn(async () => ({
          config: {
            host: "127.0.0.1",
            port: 22,
            username: "me",
            agent: new TestAgent([held]),
            hostVerifier: (_k: Buffer, verify: (ok: boolean) => void) =>
              verify(true),
          },
          outcome: { status: "ready" },
          authType: "agent",
        })),
      },
    };
    new PluginBridge(hostTransport, {
      manifest: { id: "term", capabilities: [], sandbox: {} } as never,
      ctx: ctx as never,
      tokens: new SandboxTokenStore(),
      dialect: "sqlite",
    });
    const child = new Endpoint(childTransport, {
      side: "c",
      outboundToken: () => undefined,
      inbound: (_token, run) => run(),
    });

    const result = (await child.call("ssh.prepare", [1, {}])) as {
      config: Record<string, unknown>;
      agent?: AgentRelay;
    };
    expect(result.config.agent).toBeUndefined();
    expect(result.agent).toBeDefined();

    const agent = relayedAgent(result.agent!);
    const keys = await identities(agent);
    const data = Buffer.from("auth payload");
    const sig = await signWith(agent, keys[0], data);
    expect(held.verify(data, sig)).toBe(true);
  });
});
